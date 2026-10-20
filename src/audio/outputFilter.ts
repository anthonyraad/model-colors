/** Master-output sweep shared by the key handler and the insert host. */
export const FILTER_TRAVEL_SECONDS = 2.25

/** Left-arrow return. 0 snaps to bypass. The others are quarter-note beats. */
export const FILTER_RESET_RATES = [
  { beats: 0, label: '0' },
  { beats: 0.25, label: '1/16' },
  { beats: 0.5, label: '1/8' },
  { beats: 1, label: '1/4' }
] as const

export type FilterResetBeats = (typeof FILTER_RESET_RATES)[number]['beats']

/** 12 dB is one biquad. 24 dB cascades a second stage. */
export const FILTER_SLOPES = [
  { db: 12, label: '12 dB' },
  { db: 24, label: '24 dB' }
] as const

export type FilterSlopeDb = (typeof FILTER_SLOPES)[number]['db']

/**
 * Resonance of the sweep.
 * None is Butterworth, so the passband stays flat.
 * The others are the usual musical steps for a 2nd-order filter,
 * whose resonant peak is about 20·log10(Q): low +3.5 dB, medium +12 dB, high +20 dB.
 */
export const FILTER_RESONANCE = [
  { id: 'none', label: 'None', q: 0.7071067811865476 },
  { id: 'low', label: 'Low', q: 1.5 },
  { id: 'medium', label: 'Medium', q: 4 },
  { id: 'high', label: 'High', q: 10 }
] as const

export type FilterResonanceId = (typeof FILTER_RESONANCE)[number]['id']

/** Q of each biquad. A flat 24 dB slope uses the two Butterworth sections. A chosen resonance stays on the first stage. */
export function filterSections(slope: FilterSlopeDb, resonance: FilterResonanceId): number[] {
  const q = FILTER_RESONANCE.find((item) => item.id === resonance)?.q ?? FILTER_RESONANCE[0].q
  if (slope !== 24) return [q]
  if (resonance === 'none') return [0.541196100146197, 1.3065629648763766]
  return [q, FILTER_RESONANCE[0].q]
}

export type FilterMove = 'hold' | 'high' | 'low' | 'open-high' | 'open-low' | 'reset' | 'return'

export type FilterCatch = {
  move: Exclude<FilterMove, 'reset'>
  position: number
  at: number
  /** Signed position the return started from. */
  returnFrom: number
  /** Seconds to wait for the next grid point before the ramp. */
  returnWait: number
  /** Seconds the ramp itself takes. */
  returnSpan: number
}

export function holdFilter(position: number, now: number): FilterCatch {
  return { move: 'hold', position, at: now, returnFrom: 0, returnWait: 0, returnSpan: 0 }
}

export function filterGesture(held: { up: boolean; down: boolean; right: boolean }): Exclude<FilterMove, 'reset'> {
  if (held.right && held.down && !held.up) return 'open-high'
  if (held.right && held.up && !held.down) return 'open-low'
  if (held.up && !held.down) return 'high'
  if (held.down && !held.up) return 'low'
  return 'hold'
}

/** Where a gesture begins. Open moves jump to the far end. Reset lands on bypass. */
export function applyFilterEdge(position: number, move: FilterMove): number {
  if (move === 'reset') return 0
  if (move === 'open-high') return 1
  if (move === 'open-low') return -1
  return Math.min(1, Math.max(-1, position))
}

/** Advance a sweep. Open moves stop at bypass and never cross it. */
export function stepFilter(position: number, move: FilterMove, seconds: number): number {
  const step = (seconds > 0 ? seconds : 0) / FILTER_TRAVEL_SECONDS
  if (move === 'high') return Math.min(1, position + step)
  if (move === 'low') return Math.max(-1, position - step)
  if (move === 'open-high') return Math.max(0, position - step)
  if (move === 'open-low') return Math.min(0, position + step)
  return position
}

export function catchFilter(previous: FilterCatch | null, move: FilterMove, now: number): FilterCatch {
  const base = previous ?? holdFilter(0, now)
  const stepped = projectFilter(base, now)
  if (move === 'return') return stepped
  return {
    move: move === 'reset' ? 'hold' : move,
    position: applyFilterEdge(stepped.position, move),
    at: now,
    returnFrom: 0,
    returnWait: 0,
    returnSpan: 0
  }
}

/**
 * A note-value reset. While the transport is running, the ramp waits for the next
 * division of that rate and then takes exactly one division to reach bypass.
 * Without a transport there is no grid, so the ramp starts at once and still lasts that note.
 */
export function scheduleFilterReset(
  previous: FilterCatch | null,
  now: number,
  divisionBeats: number,
  musicalBeat: number | null,
  bpm: number
): FilterCatch {
  const stepped = projectFilter(previous ?? holdFilter(0, now), now)
  const tempo = bpm >= 20 && bpm <= 400 ? bpm : 120
  if (!(divisionBeats > 0) || Math.abs(stepped.position) < 0.0001) return holdFilter(0, now)
  let waitBeats = 0
  if (musicalBeat != null && Number.isFinite(musicalBeat)) {
    const phase = ((musicalBeat % divisionBeats) + divisionBeats) % divisionBeats
    const epsilon = 1 / 48
    waitBeats = phase < epsilon ? 0 : divisionBeats - phase
  }
  return {
    move: 'return',
    position: stepped.position,
    at: now,
    returnFrom: stepped.position,
    returnWait: (waitBeats * 60) / tempo,
    returnSpan: (divisionBeats * 60) / tempo
  }
}

export function projectFilter(state: FilterCatch, now: number): FilterCatch {
  if (state.move === 'return') return projectReturn(state, now)
  return {
    move: state.move,
    position: stepFilter(state.position, state.move, (now - state.at) / 1000),
    at: now,
    returnFrom: 0,
    returnWait: 0,
    returnSpan: 0
  }
}

function projectReturn(state: FilterCatch, now: number): FilterCatch {
  const elapsed = Math.max(0, (now - state.at) / 1000)
  const span = state.returnSpan > 0 ? state.returnSpan : 0
  if (span <= 0 || elapsed >= state.returnWait + span) return holdFilter(0, now)
  if (elapsed < state.returnWait) {
    return {
      move: 'return',
      position: state.returnFrom,
      at: now,
      returnFrom: state.returnFrom,
      returnWait: state.returnWait - elapsed,
      returnSpan: span
    }
  }
  const into = elapsed - state.returnWait
  const position = state.returnFrom * (1 - into / span)
  return {
    move: 'return',
    position,
    at: now,
    returnFrom: position,
    returnWait: 0,
    returnSpan: span - into
  }
}

/** Audible cutoff. Exactly neutral is bypass, so the buffer is not filtered at all. */
export function filterCutoff(
  position: number,
  sampleRate: number
): { kind: 'bypass' } | { kind: 'highpass' | 'lowpass'; hz: number } {
  if (!(position > 0.0001) && !(position < -0.0001)) return { kind: 'bypass' }
  const nyquist = sampleRate * 0.45
  if (position > 0) {
    return { kind: 'highpass', hz: Math.min(nyquist, 20 * Math.pow(10000 / 20, position)) }
  }
  const open = Math.min(18000, nyquist)
  const hz = open * Math.pow(100 / open, -position)
  return { kind: 'lowpass', hz: Math.min(nyquist, Math.max(20, hz)) }
}
