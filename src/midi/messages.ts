export const MIDI_CLOCK = 0xf8
export const MIDI_START = 0xfa
export const MIDI_STOP = 0xfc
export const ALL_NOTES_OFF = 123
export const RESET_ALL_CONTROLLERS = 121

export function clamp7(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(127, Math.round(value)))
}

export function controlChange(channel: number, controller: number, value: number): number[] {
  assertChannel(channel)
  return [0xb0 | (channel - 1), clamp7(controller), clamp7(value)]
}

export function noteOn(channel: number, note: number, velocity: number): number[] {
  assertChannel(channel)
  return [0x90 | (channel - 1), clamp7(note), clamp7(velocity)]
}

export function noteOff(channel: number, note: number): number[] {
  assertChannel(channel)
  return [0x80 | (channel - 1), clamp7(note), 0]
}

export function allNotesOff(channel: number): number[] {
  return controlChange(channel, ALL_NOTES_OFF, 0)
}

export function midiClock(): number[] {
  return [MIDI_CLOCK]
}

export function midiStart(): number[] {
  return [MIDI_START]
}

export function midiStop(): number[] {
  return [MIDI_STOP]
}

export function programChange(channel: number, program: number): number[] {
  assertChannel(channel)
  if (!Number.isInteger(program) || program < 0 || program > 127) {
    throw new Error(`Program must be 0–127, received ${program}`)
  }
  return [0xc0 | (channel - 1), program]
}

export function isResetAllControllers(bytes: number[]): boolean {
  return bytes.length >= 2 && (bytes[0] & 0xf0) === 0xb0 && bytes[1] === RESET_ALL_CONTROLLERS
}

export function isProgramChange(bytes: number[]): boolean {
  return (bytes[0] & 0xf0) === 0xc0
}

export function isSysEx(bytes: number[]): boolean {
  return bytes[0] === 0xf0
}

function assertChannel(channel: number): void {
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) {
    throw new Error(`MIDI channel must be 1–16, received ${channel}`)
  }
}
