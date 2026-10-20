# Architecture

Status: proposed for review. No application code is in the tree yet. The feasibility findings in `feasibility-os-1.13.md` are binding: the app does not grow a direct pattern-write path.

The Irodoku workspace stays untouched. This project lives at `C:\Users\antho\Documents\Development\model-cycles-editor`.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Shell | Electron, current stable, via electron-vite | Windows desktop, offline, no browser MIDI permission dance. |
| UI | React + TypeScript | Component UI for the sequencer, knobs, and lanes. |
| MIDI | `@julusian/midi` behind a `MidiTransport` interface | Maintained RtMidi binding. Input, output, SysEx, and virtual ports. Windows MIDI. If it fails on a given machine, only the adapter changes. |
| Tests | Vitest on the pure modules | Encoding, mapping, timing, schema, and the simulated device do not need Electron. |
| Project file | Versioned JSON | Diffable, migratable, no native database. |
| Installer | electron-builder, Milestone 6 | NSIS or Squirrel later. Not part of the first code milestone. |

Node.js is not on this machine's PATH yet. Milestone 2 starts by installing an LTS Node and pinning it in the README (`nvm` or the official Windows installer). The app does not call the network at runtime.

Web MIDI inside Electron is not the transport. Chromium's Web MIDI support on Windows is a poor fit, and the existing web editor already had to avoid SysEx permission just to make notes reliable.

## Three operations, three types

The UI may not render a hardware result except through one of these. They do not share a "success" flag.

```ts
type HardwareOp =
  | { kind: "live"; status: "local" | "sent" | "observed" }
  | { kind: "record"; status: "idle" | "armed" | "running" | "passFinished" | "aborted" }
  | { kind: "backup"; status: "capturing" | "captured" | "restoreArmed" | "bytesSent" };
```

- **Live.** A CC or note left the selected output. `observed` is set only when a matching message arrives from the device. There is no ack, so `sent` never upgrades itself.
- **Record.** A clocked pass finished. `passFinished` means the app transmitted the take. It does not mean the pattern matches, and it does not mean the user saved it on the device.
- **Backup.** Exact bytes captured from a user-started dump, or those same bytes handed back. `bytesSent` is not `verified`. Modified payloads have no constructor.

Local save status (`clean` / `dirty` / `autosaved`) is a different field from hardware status. The top bar shows both.

## Modules

```
src/
  midi/
    protocol/os-1.13.ts       versioned map: CC, channel role, lock policy, curve confidence
    messages.ts               note, cc, 14-bit cc, program, clock, start, stop, panic
    transport.ts              MidiTransport interface
    nodeMidiTransport.ts      @julusian/midi adapter
    simulatedCycles.ts        in-process device used by tests
    monitor.ts                ring buffer for the MIDI monitor
    coalesce.ts               knob throttle and 14-bit pairing
  hardware/
    connection.ts             selected in/out only, refresh, diagnostics
    live.ts                   track channel routing, sent vs observed
    record.ts                 guided live-record timeline
    backup.ts                 capture and exact restore, opt-in, later milestone
  project/
    schema.ts                 versioned document
    migrate.ts
    history.ts                undo / redo
    file.ts                   new, open, save, autosave, crash recovery
  sequencer/
    model.ts                  trigs, notes, locks, length, scale
    edit.ts                   paint, piano roll, copy, transpose
  automation/
    lanes.ts                  points, curves, enable, loop
    playback.ts               computer-side automation
  ui/                         Electron renderer
```

`protocol/os-1.13.ts` is the only place CC numbers appear. Widgets ask for `pitch` on track 3; the service resolves channel and CC. A future OS gets a new map file selected by a project field `targetFirmware: "1.13"`. Unknown firmware shows the 1.13 map as a labeled assumption, not as a detected fact. The device does not report its OS over the documented channel messages.

### Transport

```ts
interface MidiTransport {
  listInputs(): Promise<MidiPortInfo[]>;
  listOutputs(): Promise<MidiPortInfo[]>;
  open(selection: { inputId?: string; outputId?: string }): Promise<void>;
  close(): Promise<void>;
  send(bytes: number[], timeMs?: number): void;
  onMessage(handler: (bytes: number[], timeMs: number) => void): () => void;
}
```

`timeMs` is for clock and note scheduling. The adapter is the only file that imports `@julusian/midi`. Tests use `simulatedCycles`, which implements the same interface and speaks the documented subset:

- per-channel CC store
- note stack
- clock / start / stop
- optional encoder echo, so tests can cover `sent` vs `observed`
- a record buffer that arms only after the test calls `armLiveRecord()`
- a byte bucket for SysEx capture
- it does **not** accept a synthesized pattern dump

The simulator is not a claim that the hardware works. Test names say `simulated`.

### Scheduling

One clock service owns BPM, 24 PPQN, Start, and Stop.

- Computer playback: schedule notes and automation against this clock to the selected output.
- Live record: the same clock, plus the rule that lock CCs for a trig are sent slightly before that trig's note-on, and only the parameters whose lock policy is `recordable` are eligible. Parameters marked `live-only` still move the sound but are listed as not stored.
- Device-as-master: follow incoming clock for the on-screen playhead, and show "step unknown" until Start arrives. Live record does not use this mode, because OS 1.11 hardware does not send Start when recording begins.

Coalescing: while a knob is dragged, send at most one CC per controller per 10 ms, and always send the final value on release. LFO depth sends MSB and LSB as a pair. Panic is never coalesced away.

### Project schema (sketch)

```ts
type Project = {
  schemaVersion: 1;
  targetFirmware: "1.13";
  name: string;
  bpm: number;
  patterns: Pattern[];          // app-side; not the device's 96 slots
  activePatternId: string;
  midi: {
    tracks: [Channel, Channel, Channel, Channel, Channel, Channel];
    fx: Channel;
    auto: Channel;
    program: Channel;
  };
  unsupportedOnDevice: string[]; // filled by the transfer planner, not by hand
};

type Pattern = {
  id: string;
  name: string;
  length: number;               // 1..64, local even when the device length differs
  scale: Scale;                 // local; device must be set to match before record
  swing: number;                // local track or pattern value
  tracks: [Track, Track, Track, Track, Track, Track];
  fx: FxParams;
};

type Step = {
  on: boolean;
  note: number;                 // stored as MIDI note, C0 = 0 .. G10
  velocity: number;
  lengthSteps: number;          // local representation of LEN
  nudgeMs: number | null;       // local; record path may realize it only if quantize is off
  locks: Partial<Record<ParamId, number>>;
  condition: TrigCondition | null; // local only
  machineLock: MachineId | null;   // local until CC 70 recording is verified
  presetLockId: string | null;     // local only
};
```

`schemaVersion` plus `migrate.ts` is the compatibility story. Autosave writes a sibling `*.autosave.json` and a crash copy. Hardware blobs, if the backup tool is built later, sit next to the project as `*.syx` and are never parsed into steps.

Undo history stores project patches in memory and does not include MIDI I/O.

### Connection and panic

The connection panel lists inputs and outputs. A port whose name matches `model` and `cycles` (case-insensitive) is badged "likely Model:Cycles" and still requires an explicit Connect. Input and output are chosen separately because Windows sometimes splits them. Refresh re-enumerates. Disconnect closes both. Reconnect uses the last ids if they still exist.

The monitor shows direction, timestamp, and a short decode (note, CC name from the map, clock, sysex length). SysEx bodies are not expanded into fake parameters.

### Sequencer and automation

The grid is six tracks by 16 visible steps, paging out to the pattern length (max 64). Paint, piano roll, copy/paste, duplicate, clear, and transpose edit the local project only. Playback position comes from the app clock during computer playback, or from counted clocks after Start when following the device.

Automation lanes exist for every map entry. Each lane has `enabled` and a destination:

- `computer` — played as live CCs during app transport. Label: "playing from this computer".
- `record` — included in a live-record pass, and only if the parameter's lock policy allows it. Label: "will attempt to record as locks".

Curves interpolate in the computer destination. The record destination quantizes to steps, because the device stores locks on trigs, not on arbitrary curves. The UI says that in the lane header.

### Record wizard (Milestone 5, designed now)

The wizard is a checklist, not a single button:

1. Show the required device settings (`CLK IN`, `CLK OUT`, `PCH IN`, `RCV NOTE`, `RCV CC`, AUTO channel, `INP FROM`). The app cannot read them back.
2. User picks the target pattern. The app sends one program change. Status: sent.
3. User sets length and scale on the device to match the project. The wizard prints both values and waits for confirmation.
4. User selects a track, makes it active on the device, and enters LIVE RECORDING (`RECORD + PLAY`).
5. App sends Start, clock, notes, and eligible lock CCs for that track on AUTO, for a stated number of loops, then Stop.
6. Status becomes `passFinished`. A report lists what was sent and what was skipped (conditions, retrigs, preset locks, LFO setup, unverified machine locks, scale).
7. The wizard tells the user to save the pattern on the device (`FUNC + SETTINGS`, hold) if they want it kept. The app does not mark the hardware saved.

Repeating per track is required because live record writes the active track only.

### What the first implementation milestone contains

Milestone 1 in the brief is this research. The next code milestone (desktop shell and live control) should add:

- electron-vite app that opens offline
- transport interface, node adapter, simulator
- connection panel, monitor, panic
- protocol map consumed by a first set of knobs
- tests for CC bytes, channel routing, panic contents, and coalesce

It should not add record, SysEx send, or any "saved to hardware" badge.

## UI outline (for the shell milestone, not built yet)

Dark, dense, no Elektron artwork.

- Top: connection, BPM, transport, project name, local save state, hardware-op state.
- Left: six tracks, pattern list.
- Center: step grid and piano roll.
- Right: parameters for the selected track, and locks for the selected step. Each control shows the number, a `local` / `sent` / `observed` pip, and a tooltip with CC and channel.
- Bottom: automation, or the MIDI monitor. The panels resize.

Keyboard: space transport, Ctrl+Z / Ctrl+Shift+Z, Ctrl+C / Ctrl+V, numbers for the selected control. Tooltips carry the CC name so the protocol stays visible.

## Testing

Automated, on the simulator:

- every Appendix A CC encodes to the right bytes and channel class
- FX CCs refuse a track channel
- note on/off, program 0 and 95, clock count over one quarter note, start, stop
- panic sends note-offs, CC 123, and Stop, and does not send SysEx or program change
- coalesce keeps the last value
- record timeline aligns step 0 with Start
- project migrate from v1 to v1 is a no-op; a fixture with an unknown field is preserved
- disconnect mid-send leaves the project dirty and the hardware status unchanged

Manual, on OS 1.13, after the live-control milestone exists: the checklist in the feasibility doc's last section, plus a listen test that a sent CC changes the sound and that panic does not empty a pattern.

## Explicit non-goals

- Firmware update.
- Guessed SysEx writes, including the web editor's unused dump-request helper and forum "get pattern" frames.
- Treating a `.mcpst` or project blob as an editable sequence.
- Broadcasting MIDI.
- Claiming a write succeeded without a defined piece of evidence. For this device, that evidence does not exist for pattern contents, so the honest label is the limit.
