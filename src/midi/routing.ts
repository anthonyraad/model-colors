import { controlChange, programChange } from './messages'
import { parameterByCc, parameterById, type ParameterGroup } from './protocol'

export type Target = { kind: 'track'; index: number } | { kind: 'fx' }

export type ChannelSetup = {
  tracks: [number, number, number, number, number, number]
  fx: number | null
  auto: number | null
  program: number | null
}

export type Routed =
  | { ok: true; channel: number; messages: number[][]; parameterId: string }
  | { ok: false; reason: string }

export function defaultChannels(): ChannelSetup {
  return {
    tracks: [1, 2, 3, 4, 5, 6],
    fx: null,
    auto: 10,
    program: null
  }
}

export function routeParameter(target: Target, parameterId: string, value: number, channels: ChannelSetup): Routed {
  const parameter = parameterById(parameterId)
  if (!parameter) return { ok: false, reason: `Unknown parameter ${parameterId}` }
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    return { ok: false, reason: 'Value must be an integer from 0 to 127' }
  }

  if (target.kind === 'track' && (target.index < 0 || target.index > 5)) {
    return { ok: false, reason: 'Track index must be 0–5' }
  }

  const wanted: ParameterGroup = target.kind === 'fx' ? 'fx' : 'track'
  if (parameter.group !== wanted) {
    return {
      ok: false,
      reason:
        parameter.group === 'fx'
          ? 'Delay and reverb settings are sent on the FX channel.'
          : 'This parameter is sent on a track channel.'
    }
  }

  const channel = target.kind === 'fx' ? channels.fx : channels.tracks[target.index]
  if (channel == null) return { ok: false, reason: 'Set the FX channel before sending delay or reverb.' }
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) {
    return { ok: false, reason: 'MIDI channel must be 1–16' }
  }

  const messages = [controlChange(channel, parameter.cc, value)]
  if (parameter.lsb != null) messages.push(controlChange(channel, parameter.lsb, 0))
  return { ok: true, channel, messages, parameterId: parameter.id }
}

/** Mute CC 94. The on/off threshold is unpublished, so solo uses the ends of the range. */
export const MUTE_OFF = 0
export const MUTE_ON = 127

export function patternLabel(index: number): string {
  const bank = 'ABCDEF'[Math.floor(index / 16)] ?? '?'
  return `${bank}${String((index % 16) + 1).padStart(2, '0')}`
}

/** Digit from a number or numpad key. Shifted characters such as @ are not digits. */
export function patternDigit(code: string): string | null {
  const match = /^(?:Digit|Numpad)(\d)$/.exec(code)
  return match?.[1] ?? null
}

/** Keep the digits typed while Shift is held. Two digits cover patterns 1–16. */
export function pushPatternDigit(buffer: string, digit: string): string {
  if (!/^\d$/.test(digit) || buffer.length >= 2) return buffer
  return buffer + digit
}

/** Pattern 1–16 from the digits typed before Shift was released. */
export function patternSlotFromDigits(buffer: string): number | null {
  if (!/^\d{1,2}$/.test(buffer)) return null
  const slot = Number(buffer)
  if (slot < 1 || slot > 16) return null
  return slot
}

/** True for the keyup that ends a Shift chord. The modifier flag is still set on that event. */
export function shiftKeyReleased(code: string): boolean {
  return code === 'ShiftLeft' || code === 'ShiftRight'
}

/** Program channel when one is set, otherwise AUTO. The instrument accepts program change on either. */
export function patternMidiChannel(channels: ChannelSetup): number | null {
  return channels.program ?? channels.auto
}

/** Same bank as the current pattern. An unknown pattern stays in bank A. */
export function patternIndexInBank(current: number | null, slot: number): number {
  const bank = current == null ? 0 : Math.min(5, Math.floor(current / 16))
  return bank * 16 + (slot - 1)
}

/** Channels that should carry one pattern. An explicit Program channel wins. Otherwise every channel can be covered, because PCH IN is not readable. */
export function patternSendChannels(channels: ChannelSetup, coverAllChannels: boolean): number[] | null {
  if (channels.program != null) return [channels.program]
  if (coverAllChannels) {
    const all = Array.from({ length: 16 }, (_, index) => index + 1)
    if (channels.auto == null) return all
    return [channels.auto, ...all.filter((channel) => channel !== channels.auto)]
  }
  return channels.auto != null ? [channels.auto] : null
}

export function routeProgram(
  index: number,
  channels: ChannelSetup,
  options: { coverAllChannels?: boolean } = {}
): { ok: true; channel: number; message: number[]; messages: number[][] } | { ok: false; reason: string } {
  if (!Number.isInteger(index) || index < 0 || index > 95) {
    return { ok: false, reason: 'Choose a pattern from A01 to F16.' }
  }
  const targets = patternSendChannels(channels, options.coverAllChannels === true)
  if (targets == null || targets.length === 0) {
    return { ok: false, reason: 'Set the program channel to the Model:Cycles PCH IN channel before choosing a pattern.' }
  }
  const messages = targets.map((channel) => programChange(channel, index))
  return { ok: true, channel: targets[0], message: messages[0], messages }
}

/** Flip mute for one track, and for every other track that shares its channel. */
export function toggleMuteFlags(flags: readonly boolean[], index: number, channels: ChannelSetup): boolean[] {
  const channel = channels.tracks[index]
  const next = !(flags[index] ?? false)
  return channels.tracks.map((trackChannel, track) => (trackChannel === channel ? next : (flags[track] ?? false)))
}

export function soloLevels(
  soloIndex: number | null,
  channels: ChannelSetup
): { index: number; value: number; messages: number[][] }[] {
  const channelValue = new Map<number, number>()
  channels.tracks.forEach((channel, index) => {
    const value = soloIndex == null || index === soloIndex ? MUTE_OFF : MUTE_ON
    const existing = channelValue.get(channel)
    channelValue.set(channel, existing === MUTE_OFF || value === MUTE_OFF ? MUTE_OFF : MUTE_ON)
  })
  const sent = new Set<number>()
  return channels.tracks.map((channel, index) => {
    const value = channelValue.get(channel) ?? MUTE_OFF
    const messages = sent.has(channel) ? [] : [controlChange(channel, 94, value)]
    sent.add(channel)
    return { index, value, messages }
  })
}

export function panicChannels(channels: ChannelSetup): number[] {
  const list = [...channels.tracks]
  if (channels.fx != null) list.push(channels.fx)
  if (channels.auto != null) list.push(channels.auto)
  return list
}

export function sharedChannelWarnings(tracks: number[]): string[] {
  const owners = new Map<number, number[]>()
  tracks.forEach((channel, index) => {
    const list = owners.get(channel) ?? []
    list.push(index + 1)
    owners.set(channel, list)
  })
  const warnings: string[] = []
  for (const [channel, trackNumbers] of owners) {
    if (trackNumbers.length > 1) {
      warnings.push(
        `Tracks ${trackNumbers.join(', ')} share channel ${channel}. The lowest track number wins if those tracks receive the same control.`
      )
    }
  }
  return warnings
}

export function targetKey(target: Target, parameterId: string): string {
  return target.kind === 'fx' ? `fx:${parameterId}` : `t${target.index}:${parameterId}`
}

export type IncomingControl =
  | { kind: 'value'; target: Target; parameterId: string }
  | { kind: 'learn-fx'; target: Target; parameterId: string; channel: number }
  | { kind: 'unmapped'; parameterId: string; channel: number }
  | { kind: 'ignore' }

/** Map a received control onto a dial. An FX control with no FX channel learns that channel from the instrument. */
export function applyIncomingControl(controller: number, channel: number, channels: ChannelSetup): IncomingControl {
  const parameter = parameterByCc(controller)
  if (!parameter || parameter.lsb === controller) return { kind: 'ignore' }
  if (parameter.group === 'fx') {
    if (channels.fx == null) return { kind: 'learn-fx', target: { kind: 'fx' }, parameterId: parameter.id, channel }
    if (channels.fx !== channel) return { kind: 'unmapped', parameterId: parameter.id, channel }
    return { kind: 'value', target: { kind: 'fx' }, parameterId: parameter.id }
  }
  const index = channels.tracks.findIndex((trackChannel) => trackChannel === channel)
  if (index < 0) return { kind: 'unmapped', parameterId: parameter.id, channel }
  return { kind: 'value', target: { kind: 'track', index }, parameterId: parameter.id }
}

/** A received program change names a pattern. The first one also records the program channel. */
export function applyIncomingProgram(
  program: number,
  channel: number,
  channels: ChannelSetup
): { pattern: number | null; programChannel: number | null } {
  if (!Number.isInteger(program) || program < 0 || program > 127) {
    return { pattern: null, programChannel: channels.program }
  }
  if (channels.program != null && channels.program !== channel) {
    return { pattern: null, programChannel: channels.program }
  }
  return {
    pattern: program <= 95 ? program : null,
    programChannel: channels.program ?? channel
  }
}

/** Lowest numbered track wins when several tracks share a channel, matching the instrument. */
export function ownerForControl(
  controller: number,
  channel: number,
  channels: ChannelSetup
): { target: Target; parameterId: string } | null {
  const parameter = parameterByCc(controller)
  if (!parameter || parameter.lsb === controller) return null
  if (parameter.group === 'fx') {
    if (channels.fx !== channel) return null
    return { target: { kind: 'fx' }, parameterId: parameter.id }
  }
  const index = channels.tracks.findIndex((trackChannel) => trackChannel === channel)
  if (index < 0) return null
  return { target: { kind: 'track', index }, parameterId: parameter.id }
}
