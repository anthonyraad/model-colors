/** Master reverse and tape stop. Reverse defaults to four bars. Medium tape wind takes two beats. */
export const REVERSE_BEATS = 16
export const TAPE_BEATS = 2

export const TAPE_SPEEDS = [
  { id: 'slow', label: 'Slow', beats: 4 },
  { id: 'medium', label: 'Medium', beats: 2 },
  { id: 'fast', label: 'Fast', beats: 1 }
] as const

export type TapeSpeed = (typeof TAPE_SPEEDS)[number]['id']

/** Wind length in quarter notes. Anything outside the dropdown stays at Medium. */
export function tapeWindBeats(speed: string): number {
  const found = TAPE_SPEEDS.find((item) => item.id === speed)
  return found ? found.beats : TAPE_BEATS
}

/** Reverse quantize waits for the end of this one-bar grid. */
export const REVERSE_QUANTIZE_BEATS = 4

export const REVERSE_LENGTHS = [
  { bars: 1, label: '1 bar' },
  { bars: 2, label: '2 bars' },
  { bars: 4, label: '4 bars' },
  { bars: 8, label: '8 bars' }
] as const

export type ReverseBars = (typeof REVERSE_LENGTHS)[number]['bars']

/** Slice length in quarter notes. Anything outside the dropdown stays at four bars. */
export function reverseLengthBeats(bars: number): number {
  if (bars === 1 || bars === 2 || bars === 4 || bars === 8) return bars * 4
  return REVERSE_BEATS
}

export type MotionKind = 'reverse' | 'tape'

export type MotionState = {
  reverse: boolean
  tape: boolean
}

export function createMotionState(): MotionState {
  return { reverse: false, tape: false }
}

export function motionActive(state: MotionState): boolean {
  return state.reverse || state.tape
}

export function motionLabel(state: MotionState): string {
  if (state.tape) return 'Tape stop'
  if (state.reverse) return 'Reverse'
  return ''
}

/** The physical minus and equal keys. Shifted symbols are left alone. */
export function motionKind(code: string, key: string, shift: boolean): MotionKind | null {
  if (shift) return null
  if (code === 'Minus' || code === 'NumpadSubtract' || key === '-') return 'reverse'
  if (code === 'Equal' || key === '=') return 'tape'
  return null
}

/** Drop reverse on the request and on what is currently sounding. Tape is left as it is. */
export function dropReverse(intent: MotionState, sounding: MotionState): boolean {
  const active = intent.reverse || sounding.reverse
  intent.reverse = false
  sounding.reverse = false
  return active
}

/** Turn one motion on, or off if it is already on. The other motion clears. */
export function toggleMotion(state: MotionState, kind: MotionKind): void {
  if (kind === 'reverse') {
    state.reverse = !state.reverse
    if (state.reverse) state.tape = false
    return
  }
  state.tape = !state.tape
  if (state.tape) state.reverse = false
}

/** Hold mode writes the newest held motion, or silence when the stack is empty. */
export function writeMotion(state: MotionState, kind: MotionKind | null): void {
  state.reverse = kind === 'reverse'
  state.tape = kind === 'tape'
}

/**
 * Which motion should wait for the end of the bar.
 * Reverse and tape each follow their own quantize button.
 * Switching to the other motion follows the one that is turning on.
 */
export function motionSnap(
  intent: MotionState,
  sounding: MotionState,
  reverseQuantize: boolean,
  tapeQuantize: boolean
): MotionKind | null {
  const reverseEdge = intent.reverse !== sounding.reverse && !intent.tape
  const tapeEdge = intent.tape !== sounding.tape && !intent.reverse
  if (reverseEdge && reverseQuantize) return 'reverse'
  if (tapeEdge && tapeQuantize) return 'tape'
  return null
}

/**
 * Tape speed across one wind.
 * Slowing eases out of full speed. Returning eases into it.
 */
export function tapeSpeed(progress: number, from: number, to: number): number {
  const t = Math.min(1, Math.max(0, progress))
  if (to >= from) return from + (to - from) * Math.sin(t * Math.PI / 2)
  return to + (from - to) * Math.cos(t * Math.PI / 2)
}

/**
 * Picture speed across one wind. Both ends are flat, so motion eases out of
 * full speed and crawls into stillness instead of cutting off.
 */
export function pictureTapeRate(progress: number, from: number, to: number): number {
  const t = Math.min(1, Math.max(0, progress))
  const eased = (1 - Math.cos(t * Math.PI)) / 2
  return from + (to - from) * eased
}

export type TapePicture = {
  on: boolean
  phase: 'idle' | 'stopping' | 'stopped' | 'returning'
  progress: number
  rate: number
  from: number
  beats: number
  now: number
}

export function createTapePicture(now = 0): TapePicture {
  return { on: false, phase: 'idle', progress: 0, rate: 1, from: 1, beats: TAPE_BEATS, now }
}

/**
 * The picture clock for a tape stop. Speed eases to rest across the same wind
 * as the audio, then holds. While it is idle, `now` is the wall clock.
 */
export function stepTapePicture(
  picture: TapePicture,
  tape: boolean,
  windBeats: number,
  bpm: number,
  dt: number,
  wallNow: number
): number {
  const beats = windBeats === 1 || windBeats === 2 || windBeats === 4 ? windBeats : TAPE_BEATS
  const tempo = bpm >= 20 && bpm <= 400 ? bpm : 120
  if (tape && !picture.on) {
    picture.on = true
    picture.phase = 'stopping'
    picture.progress = 0
    picture.from = 1
    picture.beats = beats
    picture.rate = 1
  } else if (!tape && picture.on) {
    picture.on = false
    picture.phase = 'returning'
    picture.progress = 0
    picture.from = picture.rate
    picture.beats = beats
  }
  if (picture.phase === 'stopping' || picture.phase === 'returning') {
    picture.progress += (dt * tempo) / 60 / picture.beats
    const t = Math.min(1, picture.progress)
    if (picture.phase === 'stopping') {
      picture.rate = pictureTapeRate(t, 1, 0)
      if (t >= 1) {
        picture.phase = 'stopped'
        picture.rate = 0
      }
    } else {
      picture.rate = pictureTapeRate(t, picture.from, 1)
      if (t >= 1) {
        picture.phase = 'idle'
        picture.rate = 1
      }
    }
  } else if (picture.phase === 'stopped') {
    picture.rate = 0
  } else {
    picture.rate = 1
  }
  picture.now = picture.phase === 'idle' ? wallNow : picture.now + dt * picture.rate * 1000
  return picture.rate
}
