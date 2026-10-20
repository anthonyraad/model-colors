import { describe, expect, it } from 'vitest'
import { createCoalescer } from './coalesce'
import { describeMessage } from './describe'
import { isProgramChange, isResetAllControllers, isSysEx } from './messages'
import { panicMessages } from './panic'
import { samplerDialName, samplerKnobCaption } from './modelTg'
import { adoptArrivingCycles, defaultPortId, looksLikeModelCycles, parameterById, protocol } from './protocol'
import {
  applyIncomingControl,
  applyIncomingProgram,
  defaultChannels,
  ownerForControl,
  patternDigit,
  patternIndexInBank,
  patternLabel,
  patternMidiChannel,
  patternSlotFromDigits,
  pushPatternDigit,
  shiftKeyReleased,
  routeParameter,
  routeProgram,
  sharedChannelWarnings,
  soloLevels,
  toggleMuteFlags
} from './routing'
import { MidiSession, type HardwarePorts } from './session'

class FakeHardware implements HardwarePorts {
  sent: number[][] = []
  opened: { inputId: string | null; outputId: string | null } | null = null
  private handler: (bytes: number[]) => void = () => {}

  list() {
    return {
      inputs: [{ id: 'in:Elektron Model:Cycles', name: 'Elektron Model:Cycles' }],
      outputs: [
        { id: 'out:Elektron Model:Cycles', name: 'Elektron Model:Cycles' },
        { id: 'out:Other Synth', name: 'Other Synth' }
      ],
      error: null
    }
  }

  onMessage(handler: (bytes: number[]) => void): void {
    this.handler = handler
  }

  open(inputId: string | null, outputId: string | null): void {
    this.opened = { inputId, outputId }
  }

  close(): void {
    this.opened = null
  }

  send(bytes: number[]): void {
    this.sent.push([...bytes])
  }

  emit(bytes: number[]): void {
    this.handler(bytes)
  }
}

describe('protocol', () => {
  it('lists the 30 appendix controls once each', () => {
    expect(protocol.parameters).toHaveLength(30)
    expect(protocol.firmware).toBe('1.13')
    const controllers = protocol.parameters.map((parameter) => parameter.cc)
    expect(new Set(controllers).size).toBe(controllers.length)
    expect(protocol.parameters.find((parameter) => parameter.id === 'pitch')?.cc).toBe(65)
    expect(protocol.parameters.find((parameter) => parameter.id === 'lfoDepth')?.lsb).toBe(110)
    expect(protocol.parameters.find((parameter) => parameter.id === 'delayTime')?.group).toBe('fx')
  })

  it('renames Sampler dials without inventing controllers', () => {
    expect(samplerDialName('stretch', 'color')).toBe('Speed')
    expect(samplerDialName('wave', 'shape')).toBe('Frame Size')
    expect(samplerDialName('oneshot', 'pitch')).toBeNull()
    const color = parameterById('color')
    expect(color?.cc).toBe(16)
    expect(samplerKnobCaption(color!, 'stretch')).toContain('CC 16')
    expect(samplerKnobCaption(color!, 'stretch')).toContain('Speed')
    expect(protocol.parameters.some((parameter) => parameter.name === 'Attack')).toBe(false)
    const routed = routeParameter({ kind: 'track', index: 0 }, 'color', 96, defaultChannels())
    expect(routed.ok).toBe(true)
    if (routed.ok) expect(routed.messages).toEqual([[0xb0, 16, 96]])
  })

  it('prefers the Model:Cycles port, then the Focusrite port, until the user picks another', () => {
    const ports = [
      { id: 'sim:output', name: 'Simulated Model:Cycles', simulated: true },
      { id: 'out:Microsoft GS Wavetable Synth', name: 'Microsoft GS Wavetable Synth' },
      { id: 'out:Focusrite USB MIDI', name: 'Focusrite USB MIDI' },
      { id: 'out:Elektron Model:Cycles', name: 'Elektron Model:Cycles' }
    ]
    expect(defaultPortId(ports, 'sim:output', 'sim:output')).toBe('out:Elektron Model:Cycles')
    expect(defaultPortId(ports.filter((port) => port.id !== 'out:Elektron Model:Cycles'), 'sim:output', 'sim:output')).toBe(
      'out:Focusrite USB MIDI'
    )
    expect(defaultPortId(ports, 'out:Microsoft GS Wavetable Synth', 'sim:output')).toBe('out:Microsoft GS Wavetable Synth')
    expect(defaultPortId([{ id: 'sim:output', name: 'Simulated Model:Cycles', simulated: true }], 'sim:output', 'sim:output')).toBe(
      'sim:output'
    )
  })

  it('takes a wrong hardware port when the Model:Cycles arrives', () => {
    const focusrite = [
      { id: 'in:Focusrite USB MIDI', name: 'Focusrite USB MIDI' },
      { id: 'out:Focusrite USB MIDI', name: 'Focusrite USB MIDI' }
    ]
    const cycles = [
      { id: 'in:Elektron Model:Cycles', name: 'Elektron Model:Cycles' },
      { id: 'out:Elektron Model:Cycles', name: 'Elektron Model:Cycles' }
    ]
    const inputs = [focusrite[0]!, ...cycles.slice(0, 1), { id: 'sim:input', name: 'Simulated Model:Cycles', simulated: true }]
    const outputs = [focusrite[1]!, cycles[1]!, { id: 'sim:output', name: 'Simulated Model:Cycles', simulated: true }]
    expect(adoptArrivingCycles(inputs, outputs, 'in:Focusrite USB MIDI', 'out:Focusrite USB MIDI', new Set())).toEqual({
      inputId: 'in:Elektron Model:Cycles',
      outputId: 'out:Elektron Model:Cycles'
    })
    expect(
      adoptArrivingCycles(inputs, outputs, 'in:Focusrite USB MIDI', 'out:Focusrite USB MIDI', new Set(['in:Elektron Model:Cycles', 'out:Elektron Model:Cycles']))
    ).toBeNull()
    expect(adoptArrivingCycles(inputs, outputs, 'sim:input', 'sim:output', new Set())).toBeNull()
    expect(adoptArrivingCycles(inputs, outputs, cycles[0]!.id, cycles[1]!.id, new Set())).toBeNull()
    expect(adoptArrivingCycles(inputs, outputs, null, null, new Set())).toBeNull()
    expect(adoptArrivingCycles(inputs, outputs, 'in:Focusrite USB MIDI', 'out:missing', new Set())).toEqual({
      inputId: 'in:Elektron Model:Cycles',
      outputId: 'out:Elektron Model:Cycles'
    })
  })

  it('recognizes a Model:Cycles port without matching every Elektron device', () => {
    expect(looksLikeModelCycles('Elektron Model:Cycles')).toBe(true)
    expect(looksLikeModelCycles('Model Cycles MIDI')).toBe(true)
    expect(looksLikeModelCycles('Elektron Digitakt')).toBe(false)
  })
})

describe('routing', () => {
  const channels = defaultChannels()

  it('sends pitch on the track channel', () => {
    const routed = routeParameter({ kind: 'track', index: 0 }, 'pitch', 40, channels)
    expect(routed.ok).toBe(true)
    if (!routed.ok) return
    expect(routed.messages).toEqual([[0xb0, 65, 40]])
  })

  it('sends LFO depth as MSB plus a zero fine byte', () => {
    const routed = routeParameter({ kind: 'track', index: 2 }, 'lfoDepth', 70, channels)
    expect(routed.ok).toBe(true)
    if (!routed.ok) return
    expect(routed.channel).toBe(3)
    expect(routed.messages).toEqual([
      [0xb2, 109, 70],
      [0xb2, 110, 0]
    ])
  })

  it('refuses an effect control on a track and a track control on the effect channel', () => {
    expect(routeParameter({ kind: 'track', index: 0 }, 'delayTime', 10, channels).ok).toBe(false)
    const withFx = { ...channels, fx: 7 }
    expect(routeParameter({ kind: 'fx' }, 'pitch', 10, withFx).ok).toBe(false)
  })

  it('blocks effect sends until an FX channel is chosen', () => {
    const blocked = routeParameter({ kind: 'fx' }, 'delayTime', 16, channels)
    expect(blocked.ok).toBe(false)
    const sent = routeParameter({ kind: 'fx' }, 'delayTime', 16, { ...channels, fx: 7 })
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    expect(sent.messages).toEqual([[0xb6, 85, 16]])
  })

  it('follows a knob the instrument sends, and learns the FX channel from the first FX control', () => {
    const channels = defaultChannels()
    expect(applyIncomingControl(65, 1, channels)).toEqual({
      kind: 'value',
      target: { kind: 'track', index: 0 },
      parameterId: 'pitch'
    })
    expect(applyIncomingControl(65, 11, channels)).toEqual({ kind: 'unmapped', parameterId: 'pitch', channel: 11 })
    expect(applyIncomingControl(110, 1, channels)).toEqual({ kind: 'ignore' })
    expect(applyIncomingControl(85, 7, channels)).toEqual({
      kind: 'learn-fx',
      target: { kind: 'fx' },
      parameterId: 'delayTime',
      channel: 7
    })
    expect(applyIncomingProgram(16, 4, channels)).toEqual({ pattern: 16, programChannel: 4 })
    expect(applyIncomingProgram(2, 9, { ...channels, program: 4 })).toEqual({ pattern: null, programChannel: 4 })
  })

  it('assigns an incoming control to the lowest track on that channel', () => {
    const shared = { ...channels, tracks: [5, 5, 3, 4, 5, 6] as ChannelSetupTracks }
    expect(ownerForControl(65, 5, shared)).toEqual({ target: { kind: 'track', index: 0 }, parameterId: 'pitch' })
    expect(ownerForControl(110, 5, shared)).toBeNull()
    expect(ownerForControl(85, 9, { ...channels, fx: 9 })).toEqual({
      target: { kind: 'fx' },
      parameterId: 'delayTime'
    })
  })

  it('warns when tracks share a channel', () => {
    expect(sharedChannelWarnings([1, 1, 3, 4, 5, 6])).toHaveLength(1)
    expect(sharedChannelWarnings([1, 2, 3, 4, 5, 6])).toHaveLength(0)
  })
})

describe('panic', () => {
  it('sends note-offs, All Notes Off, and Stop, and nothing that edits a pattern', () => {
    const messages = panicMessages([1, 1, 7], [{ channel: 1, note: 60 }])
    expect(messages).toEqual([
      [0x80, 60, 0],
      [0xb0, 123, 0],
      [0xb6, 123, 0],
      [0xfc]
    ])
    for (const message of messages) {
      expect(isSysEx(message)).toBe(false)
      expect(isProgramChange(message)).toBe(false)
      expect(isResetAllControllers(message)).toBe(false)
    }
  })
})

describe('coalesce', () => {
  it('keeps only the latest value and sends it once the interval elapses', () => {
    let now = 0
    const sent: number[][][] = []
    const queued: (() => void)[] = []
    const coalescer = createCoalescer({
      intervalMs: 10,
      now: () => now,
      schedule: (fn) => {
        queued.push(fn)
        return { cancel: () => queued.splice(queued.indexOf(fn), 1) }
      },
      send: (_key, messages) => sent.push(messages)
    })
    coalescer.push('pitch', [[0xb0, 65, 1]])
    coalescer.push('pitch', [[0xb0, 65, 40]])
    expect(sent).toHaveLength(0)
    now = 10
    queued[0]?.()
    expect(sent).toEqual([[[0xb0, 65, 40]]])
  })
})

describe('patterns and solo', () => {
  it('names the 96 patterns and sends a program change on the program channel', () => {
    expect(patternLabel(0)).toBe('A01')
    expect(patternLabel(15)).toBe('A16')
    expect(patternLabel(16)).toBe('B01')
    expect(patternLabel(95)).toBe('F16')
    expect(routeProgram(0, { ...defaultChannels(), auto: null }).ok).toBe(false)
    expect(patternMidiChannel(defaultChannels())).toBe(10)
    expect(routeProgram(0, defaultChannels())).toEqual({ ok: true, channel: 10, message: [0xc9, 0], messages: [[0xc9, 0]] })
    const channels = { ...defaultChannels(), program: 9 }
    const routed = routeProgram(5, channels)
    expect(routed).toEqual({ ok: true, channel: 9, message: [0xc8, 5], messages: [[0xc8, 5]] })
    const covered = routeProgram(0, defaultChannels(), { coverAllChannels: true })
    expect(covered.ok && covered.messages).toHaveLength(16)
    expect(covered.ok && covered.messages[0]).toEqual([0xc9, 0])
    expect(covered.ok && new Set(covered.messages.map((message) => message[0])).size).toBe(16)
    const explicit = routeProgram(0, { ...defaultChannels(), program: 4 }, { coverAllChannels: true })
    expect(explicit).toEqual({ ok: true, channel: 4, message: [0xc3, 0], messages: [[0xc3, 0]] })
    expect(describeMessage([0xc8, 5])).toBe('Program A06, channel 9')
  })

  it('reads a pattern number when Shift is released', () => {
    expect(patternDigit('Digit2')).toBe('2')
    expect(patternDigit('Numpad2')).toBe('2')
    expect(patternDigit('KeyA')).toBeNull()
    let typed = ''
    typed = pushPatternDigit(typed, '1')
    typed = pushPatternDigit(typed, '2')
    typed = pushPatternDigit(typed, '3')
    expect(typed).toBe('12')
    expect(patternSlotFromDigits(typed)).toBe(12)
    expect(patternSlotFromDigits('2')).toBe(2)
    expect(patternSlotFromDigits('16')).toBe(16)
    expect(patternSlotFromDigits('17')).toBeNull()
    expect(patternSlotFromDigits('0')).toBeNull()
    expect(patternSlotFromDigits('')).toBeNull()
    expect(patternIndexInBank(null, 12)).toBe(11)
    expect(patternIndexInBank(16, 3)).toBe(18)
    expect(patternLabel(patternIndexInBank(16, 3))).toBe('B03')
    expect(shiftKeyReleased('ShiftLeft')).toBe(true)
    expect(shiftKeyReleased('ShiftRight')).toBe(true)
    expect(shiftKeyReleased('Digit1')).toBe(false)
  })

  it('solos a track with mute values at the ends of the range', () => {
    const levels = soloLevels(0, defaultChannels())
    expect(levels.map((item) => item.value)).toEqual([0, 127, 127, 127, 127, 127])
    expect(levels[0]?.messages).toEqual([[0xb0, 94, 0]])
    expect(levels[1]?.messages).toEqual([[0xb1, 94, 127]])
    const shared = defaultChannels()
    shared.tracks = [1, 1, 3, 4, 5, 6]
    const mixed = soloLevels(1, shared)
    expect(mixed[0]?.value).toBe(0)
    expect(mixed[0]?.messages).toEqual([[0xb0, 94, 0]])
    expect(mixed[1]?.messages).toEqual([])
  })

  it('toggles mute on one track channel with the ends of the range', () => {
    const muted = routeParameter({ kind: 'track', index: 2 }, 'mute', 127, defaultChannels())
    const open = routeParameter({ kind: 'track', index: 2 }, 'mute', 0, defaultChannels())
    expect(muted).toMatchObject({ ok: true, messages: [[0xb2, 94, 127]] })
    expect(open).toMatchObject({ ok: true, messages: [[0xb2, 94, 0]] })
    const flags = [false, false, false, false, false, false]
    expect(toggleMuteFlags(flags, 0, defaultChannels())).toEqual([true, false, false, false, false, false])
    expect(toggleMuteFlags([true, false, false, false, false, false], 0, defaultChannels())[0]).toBe(false)
    const shared = defaultChannels()
    shared.tracks = [1, 1, 3, 4, 5, 6]
    expect(toggleMuteFlags(flags, 1, shared).slice(0, 2)).toEqual([true, true])
  })
})

describe('session', () => {
  it('does not transmit until an output is connected, and then only to that output', async () => {
    const hardware = new FakeHardware()
    const monitor: string[] = []
    const session = new MidiSession(hardware, {
      onMonitor: (entry) => monitor.push(`${entry.direction}:${entry.text}`)
    })
    expect(session.sendParameter({ kind: 'track', index: 0 }, 'decay', 20, true).ok).toBe(false)
    expect(hardware.sent).toHaveLength(0)

    expect((await session.connect('sim:input', 'sim:output')).ok).toBe(true)
    const sent = session.sendParameter({ kind: 'track', index: 1 }, 'color', 8, true)
    expect(sent).toEqual({ ok: true, status: 'observed' })
    expect(hardware.sent).toHaveLength(0)
    expect(hardware.opened).toEqual({ inputId: null, outputId: null })
    expect(monitor.some((line) => line.startsWith('out:Color'))).toBe(true)
    expect(describeMessage([0xb1, 16, 8])).toContain('Color')
  })

  it('sends a hardware parameter to the selected output only', async () => {
    const hardware = new FakeHardware()
    const session = new MidiSession(hardware)
    await session.connect(null, 'out:Elektron Model:Cycles')
    session.sendParameter({ kind: 'track', index: 0 }, 'shape', 3, true)
    expect(hardware.sent).toEqual([[0xb0, 17, 3]])
    expect(hardware.opened?.outputId).toBe('out:Elektron Model:Cycles')
  })

  it('coalesces a drag and can panic without sending the discarded value', async () => {
    let now = 0
    const queued: (() => void)[] = []
    const hardware = new FakeHardware()
    const session = new MidiSession(hardware, {}, {
      now: () => now,
      delay: async () => {},
      schedule: (fn) => {
        queued.push(fn)
        return { cancel: () => queued.splice(queued.indexOf(fn), 1) }
      }
    })
    await session.connect(null, 'out:Elektron Model:Cycles')
    session.sendParameter({ kind: 'track', index: 0 }, 'sweep', 4, false)
    session.sendParameter({ kind: 'track', index: 0 }, 'sweep', 9, false)
    expect(hardware.sent).toHaveLength(0)
    const panic = session.panic()
    expect(panic.ok).toBe(true)
    now = 50
    queued[0]?.()
    expect(hardware.sent.some((message) => message[1] === 18)).toBe(false)
    expect(hardware.sent.at(-1)).toEqual([0xfc])
  })

  it('echoes the loopback probe on the simulator and times out on hardware', async () => {
    const hardware = new FakeHardware()
    const session = new MidiSession(hardware, {}, { delay: async () => {} })
    await session.connect('sim:input', 'sim:output')
    await expect(session.loopback()).resolves.toMatchObject({ echoed: true })

    await session.connect('in:Elektron Model:Cycles', 'out:Elektron Model:Cycles')
    await expect(session.loopback()).resolves.toMatchObject({ echoed: false })
    expect(hardware.sent.at(-1)?.[0]).toBe(0xf0)
    expect(hardware.sent.at(-1)?.[1]).toBe(0x7d)
  })

  it('reports a knob and a pattern the instrument sends', async () => {
    const hardware = new FakeHardware()
    const controls: string[] = []
    const programs: number[] = []
    const session = new MidiSession(hardware, {
      onControl: (event) => controls.push(`${event.channel}:${event.controller}:${event.value}`),
      onProgram: (event) => programs.push(event.program)
    })
    await session.connect('in:Elektron Model:Cycles', 'out:Elektron Model:Cycles')
    hardware.emit([0xb0, 65, 40])
    hardware.emit([0xc0, 16])
    expect(controls).toEqual(['1:65:40'])
    expect(programs).toEqual([16])
  })

  it('sends a pattern program change and a solo without touching the pattern data', async () => {
    const hardware = new FakeHardware()
    const session = new MidiSession(hardware)
    await session.connect(null, 'out:Elektron Model:Cycles')
    expect(session.getPattern()).toBeNull()
    expect(session.sendProgram(0)).toMatchObject({ ok: true })
    expect(session.getPattern()).toBe(0)
    expect(hardware.sent).toEqual([[0xc9, 0]])
    session.setChannels({ ...defaultChannels(), program: 1 })
    expect(session.sendProgram(0)).toMatchObject({ ok: true })
    expect(hardware.sent.at(-1)).toEqual([0xc0, 0])
    expect(session.solo(2)).toMatchObject({ ok: true })
    expect(hardware.sent.filter((message) => isProgramChange(message))).toEqual([
      [0xc9, 0],
      [0xc0, 0]
    ])
    const learned: number[] = []
    const listening = new MidiSession(hardware, { onProgram: (event) => learned.push(event.channel) })
    await listening.connect(null, 'out:Elektron Model:Cycles')
    listening.sendProgram(1)
    hardware.emit([0xc9, 1])
    expect(learned).toEqual([])
    expect(hardware.sent.filter((message) => message[1] === 94)).toEqual([
      [0xb0, 94, 127],
      [0xb1, 94, 127],
      [0xb2, 94, 0],
      [0xb3, 94, 127],
      [0xb4, 94, 127],
      [0xb5, 94, 127]
    ])
    expect(hardware.sent.some((message) => isSysEx(message))).toBe(false)
  })

  it('sends Start and clock, and keeps clock out of the monitor', async () => {
    const hardware = new FakeHardware()
    const monitor: string[] = []
    const session = new MidiSession(hardware, {
      onMonitor: (entry) => monitor.push(entry.text)
    })
    expect(session.realtime('start').ok).toBe(false)
    expect((await session.connect(null, 'out:Elektron Model:Cycles')).ok).toBe(true)
    expect(session.realtime('start')).toEqual({ ok: true })
    expect(session.realtime('clock')).toEqual({ ok: true })
    expect(session.realtime('stop')).toEqual({ ok: true })
    expect(hardware.sent).toEqual([[0xfa], [0xf8], [0xfc]])
    expect(monitor).toEqual(['Start', 'Stop'])
  })

  it('reports notes the Model:Cycles plays on its track channels', () => {
    const hardware = new FakeHardware()
    const notes: { channel: number; note: number; velocity: number; on: boolean }[] = []
    new MidiSession(hardware, {
      onNote: (event) => notes.push(event)
    })
    hardware.emit([0x90, 48, 100])
    hardware.emit([0x80, 48, 0])
    hardware.emit([0x95, 36, 0])
    expect(notes).toEqual([
      { channel: 1, note: 48, velocity: 100, on: true },
      { channel: 1, note: 48, velocity: 0, on: false },
      { channel: 6, note: 36, velocity: 0, on: false }
    ])
  })

  it('follows incoming clock without writing it to the monitor', () => {
    const hardware = new FakeHardware()
    const monitor: string[] = []
    const realtime: string[] = []
    new MidiSession(hardware, {
      onMonitor: (entry) => monitor.push(entry.text),
      onRealtime: (kind) => realtime.push(kind)
    })
    hardware.emit([0xf8])
    hardware.emit([0xfa])
    hardware.emit([0xfc])
    hardware.emit([0xfe])
    expect(realtime).toEqual(['clock', 'start', 'stop'])
    expect(monitor).toEqual(['Start', 'Stop'])
  })
})

type ChannelSetupTracks = [number, number, number, number, number, number]
