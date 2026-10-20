# Model:Cycles Editor

A Windows desktop companion for the Elektron Model:Cycles. This version connects over MIDI and sends live parameter changes. It does not record patterns onto the device, and it does not write SysEx.

The parameter map is the OS 1.13 appendix in `protocol/model-cycles-os-1.13.json`. Knob numbers are raw MIDI values, 0–127. The manual does not publish the curve from those values to the numbers on the instrument's screen.

If the Cycles is running Model-TG, choose Sampler and a playback mode on the track. That renames Color, Shape, Sweep, and Contour to that mode's dials and still sends those four stock controllers. Attack, slide trigs, Scale Lock, sample locks, the retrig effects, and resampling have no MIDI controller, so this app does not pretend to send them.

## Requirements

- Windows 10 or 11
- Node.js 22 or newer
- A Model:Cycles on USB, or the built-in simulator

The app does not use the network while it is running.

## Commands

```bash
npm install
npm test
npm run dev
```

`npm run dev` opens the desktop window. `npm test` checks message encoding, channel routing, panic, and send coalescing without a device.

Other commands:

```bash
npm run build      # compile to out/
npm run preview    # open the compiled app
npm run typecheck
```

If `npm install` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, retry with the system certificate store:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm install
```

npm 11 may also skip native install scripts until they are approved. The MIDI library ships a prebuilt N-API binary, so it does not need a compiler:

```powershell
npm install-scripts approve @julusian/midi esbuild
npm rebuild @julusian/midi esbuild
node .\node_modules\electron\install.js
```

`npm run rebuild:midi` compiles that library for Electron and needs Python. The prebuilt binary already loads in Electron, so that command is only for a machine where the prebuild will not load.

## Using it

1. Refresh the port list.
2. Choose an input and an output. A Model:Cycles port is marked when its name matches. Nothing is sent until you press Connect, and only the ports you selected are opened.
3. Confirm the six track channels. The manual's defaults are 1–6. Set FX before moving delay or reverb; the manual does not print a factory FX channel.
4. Move a knob. Its state becomes **Sent**. The instrument does not acknowledge controls. **Observed** means a matching message came back, which the simulator can do and which the hardware does only when its encoders are set to transmit (`MOUT` on, `ENCS` = `I+E`, USB output on).
5. Panic sends All Notes Off and MIDI Stop. It asks you to confirm. It does not clear a pattern.

On the device, set `INP FROM` to USB or USB+MIDI and `RCV CC` to ON before expecting a knob to change the sound.

## What this version leaves out

Sequencer editing, project files, automation lanes, clock sync, and live-record transfer are later steps. Saving a project in a future version will still be separate from saving a pattern on the Model:Cycles.
