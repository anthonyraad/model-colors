import { createCoalescer, type Schedule } from './coalesce'
import { describeMessage, isLoopbackProbe, LOOPBACK_PROBE } from './describe'
import { isResetAllControllers, isSysEx, midiClock, midiStart, midiStop } from './messages'
import { looksLikeModelCycles } from './protocol'
import { panicMessages } from './panic'
import { defaultChannels, panicChannels, patternLabel, routeParameter, routeProgram, soloLevels, type ChannelSetup, type Target } from './routing'
import { SimulatedCycles } from './simulatedCycles'

export const SIM_INPUT_ID = 'sim:input'
export const SIM_OUTPUT_ID = 'sim:output'

export type PortInfo = {
  id: string
  name: string
  likely: boolean
  simulated: boolean
}

export type PortList = {
  inputs: PortInfo[]
  outputs: PortInfo[]
  nativeError: string | null
}

export type MonitorEntry = {
  direction: 'in' | 'out'
  text: string
  at: number
}

export type ControlEvent = {
  channel: number
  controller: number
  value: number
}

export type SentEvent = {
  target: Target
  parameterId: string
  value: number
  observed: boolean
}

export type ProgramEvent = {
  channel: number
  program: number
}

export type NoteEvent = {
  channel: number
  note: number
  velocity: number
  on: boolean
}

export type SessionListener = {
  onMonitor?: (entry: MonitorEntry) => void
  onControl?: (event: ControlEvent) => void
  onProgram?: (event: ProgramEvent) => void
  onNote?: (event: NoteEvent) => void
  onSent?: (event: SentEvent) => void
  /** Incoming Start, clock, or Stop. Clock is not written to the monitor. */
  onRealtime?: (kind: 'start' | 'clock' | 'stop') => void
}

export type HardwarePortList = {
  inputs: { id: string; name: string }[]
  outputs: { id: string; name: string }[]
  error: string | null
}

export interface HardwarePorts {
  list(): HardwarePortList | Promise<HardwarePortList>
  open(inputId: string | null, outputId: string | null): void | Promise<void>
  close(): void | Promise<void>
  send(bytes: number[]): void
  onMessage(handler: (bytes: number[]) => void): void
}

export type SendResult =
  | { ok: true; status: 'queued' | 'sent' | 'observed' }
  | { ok: false; reason: string }

const sentDetail = 'Sent. The Model:Cycles does not acknowledge control changes.'
const observedDetail = 'Observed. The simulator echoed the value. A real Model:Cycles does this only when its encoders are set to send MIDI.'

export class MidiSession {
  readonly simulator = new SimulatedCycles({ echoParameters: true })
  private channels: ChannelSetup = defaultChannels()
  private inputId: string | null = null
  private outputId: string | null = null
  private inputName: string | null = null
  private outputName: string | null = null
  private loopbackWait: (() => void) | null = null
  private ignoreIncomingProgramUntil = 0
  private pattern: number | null = null
  private readonly listener: SessionListener
  private readonly delay: (ms: number) => Promise<void>
  private readonly coalescer: ReturnType<typeof createCoalescer>

  constructor(
    private readonly hardware: HardwarePorts,
    listener: SessionListener = {},
    options: { now?: () => number; schedule?: Schedule; delay?: (ms: number) => Promise<void> } = {}
  ) {
    this.listener = listener
    this.delay =
      options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.hardware.onMessage((bytes) => this.receive(bytes))
    this.coalescer = createCoalescer({
      intervalMs: 10,
      now: options.now ?? (() => performance.now()),
      schedule: options.schedule,
      send: (key, messages) => {
        const echoed = messages.some((message) => this.transmit(message).echoed)
        const parsed = parseTargetKey(key)
        const value = messages[0]?.[2]
        if (parsed && value != null) {
          this.listener.onSent?.({ ...parsed, value, observed: echoed })
        }
      }
    })
  }

  async listPorts(): Promise<PortList> {
    const hardware = await this.hardware.list()
    const simIn = { id: SIM_INPUT_ID, name: 'Simulated Model:Cycles', likely: false, simulated: true }
    const simOut = { id: SIM_OUTPUT_ID, name: 'Simulated Model:Cycles', likely: false, simulated: true }
    return {
      inputs: [simIn, ...hardware.inputs.map(markHardware)],
      outputs: [simOut, ...hardware.outputs.map(markHardware)],
      nativeError: hardware.error
    }
  }

  status() {
    return {
      inputId: this.inputId,
      outputId: this.outputId,
      inputName: this.inputName,
      outputName: this.outputName,
      connected: this.inputId != null || this.outputId != null
    }
  }

  setChannels(channels: ChannelSetup): void {
    this.channels = {
      tracks: [...channels.tracks] as ChannelSetup['tracks'],
      fx: channels.fx,
      auto: channels.auto,
      program: channels.program
    }
  }

  getChannels(): ChannelSetup {
    return {
      tracks: [...this.channels.tracks] as ChannelSetup['tracks'],
      fx: this.channels.fx,
      auto: this.channels.auto,
      program: this.channels.program
    }
  }

  setSimulatorEcho(enabled: boolean): void {
    this.simulator.echoParameters = enabled
  }

  async connect(inputId: string | null, outputId: string | null): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!inputId && !outputId) return { ok: false, reason: 'Choose an input, an output, or both.' }
    const ports = await this.listPorts()
    const input = inputId ? ports.inputs.find((port) => port.id === inputId) : null
    const output = outputId ? ports.outputs.find((port) => port.id === outputId) : null
    if (inputId && !input) return { ok: false, reason: 'That input is no longer available. Refresh the list.' }
    if (outputId && !output) return { ok: false, reason: 'That output is no longer available. Refresh the list.' }
    await this.hardware.close()
    try {
      await this.hardware.open(input?.simulated ? null : (input?.id ?? null), output?.simulated ? null : (output?.id ?? null))
    } catch (error) {
      await this.hardware.close()
      this.inputId = null
      this.outputId = null
      this.inputName = null
      this.outputName = null
      return { ok: false, reason: error instanceof Error ? error.message : 'Could not open the MIDI port.' }
    }
    this.inputId = input?.id ?? null
    this.outputId = output?.id ?? null
    this.inputName = input?.name ?? null
    this.outputName = output?.name ?? null
    return { ok: true }
  }

  async disconnect(): Promise<void> {
    this.coalescer.discard()
    await this.hardware.close()
    this.inputId = null
    this.outputId = null
    this.inputName = null
    this.outputName = null
  }

  sendParameter(target: Target, parameterId: string, value: number, immediate: boolean): SendResult {
    if (!this.outputId) return { ok: false, reason: 'Connect an output before sending. Nothing was transmitted.' }
    const routed = routeParameter(target, parameterId, value, this.channels)
    if (!routed.ok) return routed
    const key = target.kind === 'fx' ? `fx:${parameterId}` : `t${target.index}:${parameterId}`
    if (!immediate) {
      this.coalescer.push(key, routed.messages)
      return { ok: true, status: 'queued' }
    }
    this.coalescer.drop(key)
    const echoed = routed.messages.some((message) => this.transmit(message).echoed)
    this.listener.onSent?.({ target, parameterId, value, observed: echoed })
    return { ok: true, status: echoed ? 'observed' : 'sent' }
  }

  play(messages: number[][]): { ok: true } | { ok: false; reason: string } {
    if (!this.outputId) return { ok: false, reason: 'Connect an output before sending notes to the Model:Cycles.' }
    for (const message of messages) {
      const kind = message[0] & 0xf0
      if (kind !== 0x80 && kind !== 0x90) return { ok: false, reason: 'Playback only sends notes.' }
      if (isSysEx(message) || isResetAllControllers(message)) return { ok: false, reason: 'Playback only sends notes.' }
    }
    for (const message of messages) this.transmit(message)
    return { ok: true }
  }

  /** MIDI Start, clock, or Stop. Clock is not written to the monitor. */
  realtime(kind: 'start' | 'clock' | 'stop'): { ok: true } | { ok: false; reason: string } {
    if (!this.outputId) return { ok: false, reason: 'Connect an output before controlling the Model:Cycles. Nothing was sent.' }
    if (kind !== 'start' && kind !== 'clock' && kind !== 'stop') {
      return { ok: false, reason: 'Transport only sends Start, clock, or Stop.' }
    }
    const message = kind === 'start' ? midiStart() : kind === 'clock' ? midiClock() : midiStop()
    this.transmit(message)
    return { ok: true }
  }

  getPattern(): number | null {
    return this.pattern
  }

  sendProgram(index: number): { ok: true; detail: string } | { ok: false; reason: string } {
    if (!this.outputId) return { ok: false, reason: 'Connect an output before choosing a pattern. Nothing was sent.' }
    const routed = routeProgram(index, this.channels)
    if (!routed.ok) return routed
    this.ignoreIncomingProgramUntil = Date.now() + 200
    this.pattern = index
    this.transmit(routed.message)
    return {
      ok: true,
      detail: `Sent ${patternLabel(index)} as program ${index} on channel ${routed.channel}. During playback it waits until the pattern ends.`
    }
  }

  solo(index: number | null): { ok: true; detail: string } | { ok: false; reason: string } {
    if (!this.outputId) return { ok: false, reason: 'Connect an output before soloing. Nothing was sent.' }
    if (index != null && (!Number.isInteger(index) || index < 0 || index > 5)) {
      return { ok: false, reason: 'Solo track must be 1–6.' }
    }
    for (const item of soloLevels(index, this.channels)) {
      for (const message of item.messages) this.transmit(message)
      this.listener.onSent?.({
        target: { kind: 'track', index: item.index },
        parameterId: 'mute',
        value: item.value,
        observed: false
      })
    }
    return {
      ok: true,
      detail:
        index == null
          ? 'Sent Mute 0 on every track channel. The mute on/off threshold is unpublished.'
          : `Sent Mute 0 on track ${index + 1} and Mute 127 on the others. The mute on/off threshold is unpublished.`
    }
  }

  panic(): { ok: true; detail: string } | { ok: false; reason: string } {
    if (!this.outputId) {
      return { ok: false, reason: 'Connect an output first. Nothing was sent, and the pattern was not changed.' }
    }
    this.coalescer.discard()
    const messages = panicMessages(panicChannels(this.channels), [])
    for (const message of messages) this.transmit(message)
    return {
      ok: true,
      detail: 'Sent note-offs for tracked notes, All Notes Off, and MIDI Stop. Patterns were not cleared.'
    }
  }

  async loopback(): Promise<{ echoed: boolean; detail: string }> {
    if (!this.outputId) return { echoed: false, detail: 'Connect an output first. Nothing was sent.' }
    let echoed = false
    this.loopbackWait = () => {
      echoed = true
    }
    this.transmit(LOOPBACK_PROBE)
    if (!echoed) await this.delay(400)
    this.loopbackWait = null
    return echoed
      ? { echoed: true, detail: 'The probe came back. The selected output reaches the selected input.' }
      : {
          echoed: false,
          detail:
            'No echo. A Model:Cycles does not answer this probe. An echo means the output is wired back to the input, or both simulator ports are selected.'
        }
  }

  private transmit(bytes: number[], quiet = false): { echoed: boolean } {
    const clock = bytes.length === 1 && bytes[0] === 0xf8
    if (!clock && !quiet) this.listener.onMonitor?.({ direction: 'out', text: describeMessage(bytes), at: Date.now() })
    let echoed = false
    if (this.outputId === SIM_OUTPUT_ID) {
      const responses = this.simulator.handle(bytes)
      if (this.inputId === SIM_INPUT_ID) {
        for (const response of responses) {
          if (sameMessage(response, bytes)) echoed = true
          this.receive(response)
        }
      }
    } else if (this.outputId) {
      this.hardware.send(bytes)
    }
    return { echoed }
  }

  private receive(bytes: number[]): void {
    if (bytes[0] === 0xfe) return
    if (bytes.length === 1 && (bytes[0] === 0xf8 || bytes[0] === 0xfa || bytes[0] === 0xfc)) {
      const kind = bytes[0] === 0xf8 ? 'clock' : bytes[0] === 0xfa ? 'start' : 'stop'
      this.listener.onRealtime?.(kind)
      if (kind === 'clock') return
    }
    this.listener.onMonitor?.({ direction: 'in', text: describeMessage(bytes), at: Date.now() })
    if (isLoopbackProbe(bytes) || bytes.length === 0) {
      if (isLoopbackProbe(bytes)) this.loopbackWait?.()
      return
    }
    const kind = bytes[0] & 0xf0
    const channel = (bytes[0] & 0x0f) + 1
    if (kind === 0xb0 && bytes.length >= 3 && bytes[1] !== 123) {
      this.listener.onControl?.({ channel, controller: bytes[1], value: bytes[2] })
    }
    if (kind === 0xc0 && bytes.length >= 2) {
      const program = bytes[1] ?? 0
      if (program <= 95) this.pattern = program
      if (Date.now() >= this.ignoreIncomingProgramUntil) this.listener.onProgram?.({ channel, program })
    }
    if ((kind === 0x90 || kind === 0x80) && bytes.length >= 3) {
      const velocity = bytes[2] ?? 0
      this.listener.onNote?.({
        channel,
        note: bytes[1] ?? 0,
        velocity: kind === 0x80 ? 0 : velocity,
        on: kind === 0x90 && velocity > 0
      })
    }
  }
}

function markHardware(port: { id: string; name: string }): PortInfo {
  return { ...port, likely: looksLikeModelCycles(port.name), simulated: false }
}

function sameMessage(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

function parseTargetKey(key: string): { target: Target; parameterId: string } | null {
  const split = key.indexOf(':')
  if (split <= 0) return null
  const head = key.slice(0, split)
  const parameterId = key.slice(split + 1)
  if (head === 'fx') return { target: { kind: 'fx' }, parameterId }
  if (head.startsWith('t')) return { target: { kind: 'track', index: Number(head.slice(1)) }, parameterId }
  return null
}

export { sentDetail, observedDetail }
