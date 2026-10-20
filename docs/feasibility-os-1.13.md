# Model:Cycles desktop editor — feasibility (OS 1.13)

Date: 2026-10-10. Target firmware: Elektron Model:Cycles OS 1.13 (manual dated 30 October 2024).

This report answers whether a Windows app can edit patterns visually, control the instrument live, automate parameters, and leave a pattern on the hardware that plays with the computer disconnected. It separates what the manual documents, what an existing editor has verified on OS 1.11, and what is still unknown on OS 1.13.

Sources:

- Elektron, *Model:Cycles User Manual*, OS 1.13, 30 October 2024. https://www.elektron.se/wp-content/uploads/2024/10/Model-Cycles-User-Manual_ENG_OS1.13_241030.pdf
- Elektron OS release notes. https://www.elektron.se/release-notes/modelcycles-os-release-notes
- Subsystem MIDI definition, firmware 1.13, read against that manual. https://subsystem.co/supplemental/definitions/midi/instruments/elektron/model_cycles
- pencilresearch/midi `Elektron/Model Cycles.csv` (the same appendix table).
- tkawamu0622-cmd/model-cycles-web-editor. Live-record transfer verified by its author on OS 1.11. It does not write pattern SysEx. https://github.com/tkawamu0622-cmd/model-cycles-web-editor
- dagargo/elektroid. Lists Model:Cycles as a supported device for file and SysEx transfer. It does not publish a trig-level pattern schema. https://github.com/dagargo/elektroid
- kg4zow/model-cycles. Partial, explicitly untrusted notes on the `.mcpst` preset ZIP. Not a pattern format. https://github.com/kg4zow/model-cycles
- Elektronauts threads on backup SysEx and on the OS 1.13 SysEx header bytes.

The current Cursor workspace (`Irodoku`) is a Flutter game. This editor does not belong in that repository.

## Verdict

| Goal | Feasible now? | How |
| --- | --- | --- |
| Live notes, clock, transport, and the 30 documented CCs | Yes | Standard MIDI. No acknowledgement byte exists, so the UI says **sent**, not confirmed. |
| Hear / see knob moves come back | Only if the user enables it | `MOUT` on the track, `ENCS = I+E`, and `OUT TO` includes USB. The sequencer does not transmit parameter locks, only note, velocity, and length. |
| Build a full pattern in the app and keep it on disk | Yes | Local versioned JSON. Independent of the hardware. |
| Put notes, velocity, length, and supported parameter locks onto the current pattern | Yes, with a guided live recording | Documented LIVE RECORDING on the AUTO channel. Verified in the wild on OS 1.11, not yet on this project's OS 1.13 hardware. |
| Set pattern length, scale, swing grid, retrigs, nudge, conditional trigs, preset locks, or machine locks by a direct write | No | No documented message. Length and scale must be matched on the panel. |
| Edit a pattern dump and upload the edited bytes | No, and it must not be faked | Project/pattern SysEx is a real backup format. Its payload, checksum, and field layout are not published. Restore replaces the **entire active project**. |
| Round-trip an **unmodified** backup the device itself just sent | Possible later, still unverified | Manual §12.5. The app may capture bytes and, after an explicit confirm, send those same bytes back. That is a restore, not an edit. There is no documented read-back to compare. |
| Flash firmware, or send guessed SysEx write commands | Out of scope | Forbidden for normal operation. |

A finished session can still match the success test for the features MIDI actually carries: draw a pattern, play it live, automate from the computer, save the project on disk, live-record the supported notes and locks into the hardware, have the user save the pattern on the device, disconnect, and play it. The app must list everything that did not transfer.

## 1. Channels

There is no fixed base channel. Any channel 1–16 can be assigned to a track, and several tracks may share one. If they do, the lowest-numbered track wins parameter conflicts (manual §5.2.2, p. 16).

| Port | Role | What it carries |
| --- | --- | --- |
| T1–T6 IN | One channel each | Notes and the 26 track/playback/LFO CCs for that track. `OFF` disables receive. |
| FX IN | One channel | Delay time, delay feedback, reverb size, reverb tone only. Delay **send** and reverb **send** stay on the track channel. |
| AUTO IN | Alias of the active track | Playing and recording from an external controller. The sequencer records this channel onto the active track (§9.3, §12.3.2). It does not address a fixed part. |
| PCH IN | Program change | Channel of its own, or AUTO. Obeys `SYNC > PCH IN`. |
| T1–T6 OUT, FX OUT, PCH OUT | Transmit | There is no AUTO output. Knobs transmit only when that track's `MOUT` is on **and** `FILTER > ENCS` is `I+E`. |

The manual's external-note description assumes tracks on their default channels 1–6 (§7.5). It does not print factory defaults for FX, AUTO, or PCH. The app must not invent those. AUTO channel 10 is only a suggested setting the user copies onto the device, which is what the web editor does.

Input source is `PORTS > INP FROM`: `OFF`, `MID`, `USB`, or `M+U`. USB MIDI is class compliant; no driver (§6.7). `USB MODE` may be `A+M` (audio + MIDI) or `MID`. The app opens only the ports the user selects. It never broadcasts to every interface.

## 2. Notes, transport, and program change

| Message | Status | Behavior |
| --- | --- | --- |
| Note On / Note Off | 0x9n / 0x8n | Received. Velocity is received. |
| Notes 0–5 | C0–F0 | Trigger track 1–6 when those tracks are on their default channels, regardless of which track is active (§7.5). |
| Notes 12–60 | C1–C5 | 49 chromatic pitches on the **active** track, then shifted by Keyboard Transpose (`KBT`, −60…+60). |
| Sequencer note | C0–G10 | Stored pitch in TRIG NOTE (§9.8). Wider than the external chromatic map. |
| Aftertouch, pitch bend | — | Not in the manual. Do not send them as if they did something. |
| Program change 0–95 | 0xCn | Patterns A01–F16, if `PCH IN` is ON. A change during playback is queued until the pattern ends, same as the panel (§7.5, §9.2.1). |
| Clock | 0xF8 | When `CLK IN` is ON, the device follows external clock and transport (§12.3.1). `CLK OUT` transmits them. |
| Start / Stop | 0xFA / 0xFC | Covered by "MIDI transport". The OS 1.11 editor had to send Start itself: live record does not emit Start, so the app cannot lock its downbeat to the device's clock. |
| Continue | 0xFB | Not named. Do not depend on it. |
| Song position | 0xF2 | Not named. The device does not report the current step. |
| All Notes Off | CC 123 | Release notes: the device did not honor this, and that was fixed. Safe for panic. |
| Reset All Controllers | CC 121 | Not documented. Do not send it. It may rewrite parameters. |

MIDI clock is the standard 24 pulses per quarter note. The manual does not restate the pulse count; the verified editor uses 24. Tempo itself has **no CC**. When the app is clock master, its BPM is the clock rate. When the device is master, the app follows received clocks and must not claim to know the step until it has seen Start.

`GATE` decides whether length matters (§10.5):

- GATE off: the envelope ignores Note Off and `LEN`.
- GATE on: the envelope holds until Note Off or until `LEN`, then decays.

`LEN` in the sequencer is 0.125–128 or INF (§9.8). Infinite means no note-off from that trig.

Panic, and only this:

1. Note Off for every note the app currently holds, on the channels it used.
2. CC 123 on each configured track channel, the FX channel, and the AUTO channel.
3. MIDI Stop, so a slaved sequencer stops.

Panic does not send SysEx, program change, or any "clear pattern" action.

## 3. Control changes (Appendix A)

Thirty controllers. Twenty-six go to the track channel. Four FX controllers go to the FX channel. LFO depth is the only one with an LSB (CC 110). Values in the appendix are 0–127. The manual gives musical ranges in a different chapter and does **not** define the CC curve. Identity mapping is safe only where the musical range is already 0–127.

`RCV CC` must be ON. The filter text also says "CC/NRPN", but Appendix A publishes no NRPN numbers. Do not invent an NRPN map. Subsystem's "NRPN: supported" only reflects that sentence.

### Track channel

| Parameter | CC | Musical range in the manual | Per-step lock on the device | CC curve |
| --- | --- | --- | --- | --- |
| Note (pad / trig note) | 3 | Sequencer note is C0–G10 | Yes (`NOTE`) | Unpublished |
| Mute | 94 | On/off from the panel | Not stated as a lock | Unpublished threshold |
| Track level | 95 | Level control; Control All applies | Plausible, not explicit | Unpublished |
| Pan | 10 | Control All applies | Plausible, not explicit | Unpublished |
| Pitch | 65 | −24…+24 semitones, bipolar, 0 is unchanged | Yes | Unpublished. Do not assume 64 is center until measured |
| Decay | 80 | 0–127 | Yes | Likely identity; not stated |
| Color | 16 | Depends on the machine | Yes | 0–127, meaning depends on machine |
| Shape | 17 | Depends on the machine. Chord: 38 named settings, Appendix C | Yes | Chord order is published; which CC byte is "minor" is not in the 1.13 manual |
| Sweep | 18 | Depends on the machine | Yes | 0–127 |
| Contour | 19 | Depends on the machine | Yes | 0–127 |
| Delay send | 12 | OFF, 1–127 | Yes | 0 = OFF is the natural reading, not proven |
| Reverb send | 13 | OFF, 1–127 | Yes | Same |
| Volume + distortion | 7 | 0–127, default 60. Above 60 adds distortion | Yes | Likely identity |
| Swing | 15 | 50%–80%, default 50%. Track timing, not a step | Track-level | Unpublished |
| Chance | 14 | 0%–100%, default 100%. Track-level. A conditional lock overrides it | Track-level, not a trig condition | Unpublished |
| Machine | 70 | Kick, Snare, Metal, Perc, Tone, Chord. Any track, and it can be locked | Yes, from the panel | **Value map is not in the manual** |
| Punch | 66 | On/off accent | Yes | Unpublished threshold |
| Gate | 67 | On/off | Yes | Unpublished threshold |
| LFO speed | 102 | −64…63. Negative runs the cycle backward | Yes (LFO menu / speed) | Unpublished |
| LFO multiplier | 103 | Tempo multiples, or free multiples of 120 BPM | Yes (LFO menu) | Unpublished |
| LFO fade | 104 | −64…63 | **No.** LFO SETUP cannot be locked (§10.7) | Unpublished |
| LFO destination | 105 | Appendix B destinations | Yes (LFO menu) | Unpublished index |
| LFO waveform | 106 | Triangle, sine, square, saw, envelope, ramp, random | Yes (LFO menu) | Unpublished index |
| LFO start phase | 107 | 0–127 | **No.** LFO SETUP | Likely identity; not stated |
| LFO reset | 108 | Off / on | **No.** LFO SETUP | Unpublished threshold |
| LFO depth | 109, LSB 110 | −64.0…63.0 | Yes (LFO menu) | 14-bit curve unpublished |

### FX channel

| Parameter | CC | Musical range | Lock |
| --- | --- | --- | --- |
| Delay time | 85 | 1.00–128.00, in 128th notes, relative to BPM | Pattern FX, not a track step |
| Delay feedback | 86 | 0–198 | Same. One CC cannot literally hold 0–198; the curve is unpublished |
| Reverb size | 87 | 1–127, plus INF | Same |
| Reverb tone | 88 | −64…63 | Same |

### Machines

COLOR, SHAPE, SWEEP, and CONTOUR change meaning with the machine (§10.2, §10.3.3). The manual's machine table is graphical and did not survive text extraction cleanly. Subsystem read the rendered page as:

| Machine | Color | Shape | Sweep | Contour |
| --- | --- | --- | --- | --- |
| Kick | Soft / square-like modulation | Triangle-like modulation and feedback | Pitch sweep depth and time | Modulation envelope depth |
| Snare | Inharmonicity | Modulation and feedback | Pitch sweep depth and time | Modulation envelope depth |
| Metal | Tune offset A | Modulation and feedback | Tune offset B | Modulation envelope depth |
| Perc | Inharmonicity | Modulation | Pitch sweep | Modulation envelope depth |
| Tone | Modulator ratio | Modulation | Feedback | Modulation envelope depth |
| Chord | Interval mix and oscillator balance; unison detune | Unison or chord (Appendix C) | Wavetable sweep | Filter-cutoff envelope depth |

Those four labels are the one part of the public notes that a second text source could not confirm. The app should show them as descriptions, with the raw CC value always visible.

Appendix C order for Chord shape, first to last: Unison ×2, ×3, ×4, minor, Major, sus2, sus4, m7, M7, mMaj7, Maj7, 7sus4, dim7, madd9, Madd9, m6, M6, mb5, Mb5, m7b5, M7b5, M#5, m7#5, M7#5, mb6, m9no5, M9no5, Madd9b5, Maj7b5, M7b9no5, sus4#5b9, sus4add#5, Maddb5, M6add4no5, Maj7/6no5, Maj9no5, Fourths, Fifths. That is 38 names and no numbers. The OS 1.11 editor reports that sending CC 17 value 3 selects minor. The `.mcpst` notes put minor at file byte 4. Those two can be the same fact (CC = file byte − 1) or a mistake. The file-format author says not to trust that document. Chord names in the UI are Appendix C order, and the CC index stays marked unverified until an OS 1.13 check.

Machine numbers in that same preset note (Kick 0 … Chord 5) are **not** the CC 70 map. CC 70's map is unpublished. The control may send a raw value in a calibration panel. It must not silently retarget a machine.

### What has no controller

Appendix B destinations with no CC: Fine Tune, and LFO Trig Mode. Also with no CC: pattern length, scale (`1/8X` `1/4X` `1/2X` `3/4X` `1X` `3/2X` `2X`), change length, tempo number, nudge, retrig, trig conditions, preset lock, keyboard transpose, track mute from the sequencer's mute state as distinct from CC 94, and pattern name.

The manual index still lists SAMPLE LOCKS, LOOP, and REVERSE. Those belong to Model:Samples. This instrument has no samples (§2, and the index entries have no body). Do not implement them.

## 4. Does the device report knob moves?

Yes, conditionally. It is not an acknowledgement.

A track sends knob CCs when all of the following are true (§9.4.2, §12.3.3, §12.3.5):

1. `MOUT` is enabled on that track.
2. `FILTER > ENCS` is `I+E`. `INT` suppresses encoder MIDI even if `MOUT` is on.
3. `OUT TO` is `USB` or `M+U` (or `MID` if the app is not on USB).

What comes out:

- Notes, velocity, and trig length from the sequencer and from the pads / chromatic trigs.
- Parameter CCs from the knobs, on the track or FX output channel.
- Mute changes.
- Program change on pattern change, if `PCH OUT` is ON.

What does not come out:

- Parameter locks during playback. The manual is explicit: only note, velocity, and length sequencer data are sent (§9.4.2).
- The current step, pattern length, scale, machine, conditions, or nudge.
- A reply when the device accepts a CC. Received CCs are not echoed.

So a knob value in the app has two honest states:

- **Sent.** We transmitted it. The protocol cannot confirm it.
- **Observed.** A later incoming CC on that channel has this number and value. That means the device emitted it (usually a physical knob). It does not prove the device accepted our earlier send.

If `ENCS` stays at `INT`, every knob in the app stays at **sent** or **local**. The UI must say so, not fill in a fake "synced" state.

## 5. SysEx, projects, and patterns

### What is documented

`CONFIG > BACKUP` (§12.5):

- The user starts a send of the **current project** or the **current pattern** from the panel. The computer's job is to listen.
- The device is always listening for backup SysEx.
- Receiving backup data **overwrites all data in the active project**. Not one track. Not one step. The whole working project.
- Preset files and preset folders can also be sent as SysEx from the preset menu (§8.4). That is a sound, not a sequence.
- Elektron Transfer is the supported librarian (presets, and the explore/backup flow in §6.8). Transfer's on-disk preset is a ZIP (`.mcpst`) with `manifest.json` (`ProductType` `"27"` for Model:Cycles, per the kg4zow notes) plus an opaque binary.

A project holds 96 patterns, banks A–F, 16 each (§5.1). A pattern holds six track presets, up to 64 additional preset locks, note trigs, lock trigs, conditions, machine locks, FX, swing, quantize, length, scale, BPM, and keyboard transpose (§9.1). Maximum length used by the manual is 64 steps (four 16-step pages; `CHG` of 64). Up to 80 distinct parameters may be locked in one pattern; locking one parameter on every step still counts as one (§9.12.1).

Saving on the hardware is a separate gesture: `CONFIG > PATTERN > SAVE`, or hold `FUNC + SETTINGS`. Temporary save (`FUNC + SETTINGS`, short) is RAM only and dies when another project loads (§9.12.7, §12.1). The app cannot press those keys.

### What is not documented

- No byte layout for a pattern or project dump.
- No checksum algorithm in the manual. Elektron firmware files use a 7-bit packed SysEx container; elektroid can unpack that container for devices it supports. Unpacking does not reveal trig fields.
- No remote "please send the pattern" command in the manual. Dump request opcodes circulating on forums are Analog Rytm-style guesses with a different product byte. They are not part of normal operation.
- No way to read a pattern back and diff it against what we intended.

Three different product bytes show up in public material, which is a practical reason to refuse crafted frames:

| Byte | Where it appears |
| --- | --- |
| `0x11` | First data byte of the OS 1.13 firmware SysEx (`F0 00 20 3C 11 …`), Elektronauts hex dump. This is firmware, not a pattern schema. |
| `27` (`0x1B`) | `ProductType` inside Transfer `.mcpst` / project manifests (kg4zow). |
| `0x0D` | Constant in the web editor's SysEx helper. That file says the dump opcode is unpublished and the function must not be used to build a pattern. |

Manufacturer ID `00 20 3C` is Elektron. That is the only SysEx field safe to treat as identified.

### Reverse engineering that actually exists

| Artifact | What it covers | Safe to edit and send? |
| --- | --- | --- |
| `.mcpst` preset ZIP | Some sound bytes: name, machine, pitch, color, shape, sweep, contour, decay, sends. Author marks the document incomplete and untrustworthy. No trigs. | No. Incomplete, and upload is a Transfer/SysEx write. |
| elektroid Elektron connector | Opaque preset and project file copy for many Elektron machines, including Model:Cycles in the support list. | Copying an unmodified file is a librarian feature. Rewriting the blob is not a verified editor. |
| Web editor `sysex.ts` | Header helper and an explicit refusal to synthesize pattern dumps. | No writes. |
| Forum "get pattern" / "get kit" bytes | Unverified ports of the Analog Rytm request. | Do not send. |

Release notes also say SysEx dumps could be corrupted by some computer software. A capture path has to store every byte of every message, in order, with no "helpful" repacking.

### Decision for the app

Normal operation does **not** include:

- firmware transfer
- crafted SysEx
- modified pattern or project payloads
- elektroid-style rewritten uploads

A later, opt-in backup tool may:

1. Ask the user to start `BACKUP` on the device.
2. Record the exact SysEx messages.
3. Store them beside the local project as an opaque blob, labeled with time and "unparsed".
4. Restore **those same bytes** only after a typed confirmation that the active project will be overwritten.
5. Label the result **transmitted**, never **verified**, until the user looks at the hardware.

That tool is not Milestone 1 and it is not a pattern editor.

## 6. Live recording — the real transfer path

Manual §9.3.3: hold `RECORD` and press `PLAY`. The sequencer plays, `RECORD` flashes, and the active track records:

- pads, chromatic trig keys, and external notes (pitch, velocity, and, from the release notes, microtiming)
- parameter-knob changes, stored as parameter locks, creating lock trigs where needed

Recording listens on the **AUTO** channel and writes the **active** track (§12.3.2). Sending notes on T1–T6 plays those tracks. It does not, by itself, write the sequencer. Grid recording can capture a note if the user holds a trig key and plays a keyboard (§9.3.1), which is a poor way to dump a whole pattern.

The OS 1.11 editor's hardware notes match the manual and add operational facts:

- The device keeps transmitting clock.
- Entering live record does not send MIDI Start, so slaving the app to the device does not align step 0.
- The working direction is app-as-master: `CLK IN = ON`, `CLK OUT = OFF`, `PCH IN = ON`, `RCV NOTE = ON`, `RCV CC = ON`.
- The app sends Start, 24 PPQN clock, and notes on AUTO. Start rewinds the slaved device to the top, which is why the downbeat lines up.
- Parameter locks record if the CC arrives on a step that also has a note, just before the note-on. CCs on empty steps can create trigless locks. Repeating the same locked value on later trigs is required, because a missing lock falls back to the knob.
- Quantize is toggled on the device (`RECORD` + `PLAY` twice, or `FUNC + PUNCH`). The app cannot set it. Unquantized recording is how microtiming gets in; quantized recording is how a straight grid gets in.

### What that workflow can store

| Data | Stored on the device by live record? |
| --- | --- |
| Trig on/off | Yes, where a note was played. |
| Pitch | Yes, subject to the §7.5 note map and `KBT`. Must be calibrated on OS 1.13 before calling it lossless. The internal range is C0–G10; the documented external chromatic window is notes 12–60. |
| Velocity | Yes. |
| Length / gate | Note-off timing can define `LEN`. The envelope uses it only when GATE is on. |
| Microtiming | Yes, if live-record quantize is off. The release notes discuss this being recorded from an external keyboard. Nudge has no CC; it falls out of the timing. |
| Parameter locks for knob parameters | Yes, per §9.3.3, and specifically exercised for the main track CCs by the OS 1.11 editor. |
| LFO menu locks (wave, mult, dest, depth, speed) | The panel can lock them. Whether a CC during live record locks them is not separately proven. |
| LFO setup (fade, phase, reset) | Cannot be parameter-locked at all. Live CC still changes the track setting. |
| Track-level swing, chance, level, pan, sends | Live CC changes the track. Swing in the OS 1.11 editor was baked into note timing instead of trusted as a stored lock. |
| Machine per step | Panel can lock it. CC 70 exists on OS 1.13. Recording CC 70 as a machine lock is **not verified**. |
| Conditional trigs, per-step probability, retrig, preset locks | No MIDI representation. |
| Pattern length, scale, change length, name, BPM number | No MIDI. User sets length and scale on the device so the recording lands on the right grid. BPM follows the clock while slaved. |
| Proof the take was stored | None. The app only knows that it finished sending. The user saves the pattern on the device. |

Live automation that plays from the computer during playback is a different operation. It must be labeled as computer playback even if the same CCs are used.

## 7. Consequences for the product

The local project is the complete musical object: six tracks, patterns up to 64 steps, notes, locks, automation lanes, machines, scale, tempo, and the features MIDI cannot carry. Hardware status is a second, narrower object.

Every feature the hardware cannot accept stays in the file and appears in a "not on the device" list:

- conditional trigs and the A:B / FILL / PRE / NEI / 1ST rules
- retrigs
- explicit nudge, when not produced by unquantized recording
- preset locks (up to 64 per pattern on the device, but not addressable over MIDI)
- machine locks, until CC 70 recording is verified
- LFO setup locks
- pattern length, scale, and per-track scale mode (`PATTERN` vs `TRACK`)
- names
- anything whose CC curve has not been measured, if we would otherwise claim the on-screen number matches the LCD

The app never says the hardware pattern was saved because the local file was saved.

## 8. What still has to be measured on a real OS 1.13 unit

These are checks, not guesses to ship as facts:

1. Factory channels for FX, AUTO, and PCH.
2. CC curves for bipolar parameters (pitch, LFO speed, LFO depth, reverb tone, fade) and for swing, chance, delay time, and delay feedback.
3. On/off thresholds for mute, punch, gate, and LFO reset.
4. CC 70 values for the six machines, and whether live record stores them as machine locks.
5. CC 17 values for the 38 chord shapes (the OS 1.11 report says minor = 3).
6. Whether AUTO-channel live record stores literal MIDI note numbers or the §7.5 chromatic window plus `KBT`.
7. Whether LFO-menu CCs become per-step locks.
8. Whether the device emits any SysEx reply after a backup restore. None is documented.
9. Exact default of `ENCS` on a fresh project.

Until those are measured, the UI shows raw MIDI values and keeps the musical label marked as a display aid.
