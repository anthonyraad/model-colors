/** Tempo-synced volume duck. The division is in quarter-note beats. */
export const DUCK_RATES = [
  { key: 'z', label: '1/16', beats: 0.25, custom: false },
  { key: 'x', label: '1/8', beats: 0.5, custom: false },
  { key: 'c', label: '1/4', beats: 1, custom: false },
  { key: 'v', label: '1/2', beats: 2, custom: false },
  { key: 'b', label: '1/1', beats: 4, custom: false },
  { key: 'n', label: 'Custom', beats: 0, custom: true }
] as const

/** One bar of 16th-note trigs. Bit 0 is the downbeat. */
export const DUCK_TRIGS = 16

export type DuckRate = (typeof DUCK_RATES)[number]

export type DuckCommand = {
  division: number
  bpm: number
  beats: number
  /** False leaves the output at unity. A selected rate stays on. */
  running: boolean
  /** True copies the musical beat so the dip stays on the grid. */
  seek: boolean
  /** N follows the lit trigs instead of an even division. */
  custom: boolean
  /** Bit mask of the 16 custom trigs. */
  trigs: number
}

export type DuckState = {
  division: number
  label: string
  bpm: number
  /** Quarter notes since the last MIDI Start. Zero is the downbeat. */
  clockBeats: number
  lastClockAt: number
  clocking: boolean
  /** When the Model:Cycles itself last sent transport. The app clock yields while this is fresh. */
  deviceClockAt: number
  /**
   * Wall-clock anchor for the tempo grid. Set once, never by the rate key.
   * Zero means the next position query will anchor it.
   */
  gridOrigin: number
  /** The N key. The lit trigs decide where the pump starts. */
  custom: boolean
  /** Bit mask of the 16 custom trigs. Kept when the rate is turned off. */
  trigs: number
}

const DUCK_FLOOR = 0.06
const DUCK_ATTACK = 0.002
const DUCK_HOLD = 0.016

export function createDuckState(): DuckState {
  return {
    division: 0,
    label: '',
    bpm: 120,
    clockBeats: 0,
    lastClockAt: 0,
    clocking: false,
    deviceClockAt: 0,
    gridOrigin: 0,
    custom: false,
    trigs: 0
  }
}

export function duckActive(state: DuckState): boolean {
  return state.custom || state.division > 0
}

/** Flip one of the 16 custom trigs. Index 0 is the downbeat. */
export function toggleDuckTrig(mask: number, index: number): number {
  if (index < 0 || index >= DUCK_TRIGS) return mask & 0xffff
  return (mask ^ (1 << index)) & 0xffff
}

export function duckRate(key: string): DuckRate | null {
  const name = key.toLowerCase()
  return DUCK_RATES.find((rate) => rate.key === name) ?? null
}

/**
 * Sidechain pump. The beat drops to the floor within a couple of milliseconds,
 * holds briefly, then rises through the rest of the division and is open again
 * before the next grid point.
 */
export function duckGain(beats: number, divisionBeats: number, bpm: number): number {
  if (!(divisionBeats > 0) || !(bpm > 0)) return 1
  const wrapped = ((beats % divisionBeats) + divisionBeats) % divisionBeats
  const cycle = (divisionBeats * 60) / bpm
  const seconds = (wrapped * 60) / bpm
  const attack = Math.min(DUCK_ATTACK, cycle * 0.08)
  const hold = Math.min(DUCK_HOLD, Math.max(0, cycle * 0.22 - attack))
  if (seconds <= attack) {
    const slope = attack > 0 ? seconds / attack : 1
    return 1 - (1 - DUCK_FLOOR) * slope
  }
  if (seconds <= attack + hold) return DUCK_FLOOR
  const span = Math.max(0.0001, cycle - attack - hold)
  const progress = Math.min(1, (seconds - attack - hold) / span)
  const rise = Math.sin((progress * Math.PI) / 2)
  return DUCK_FLOOR + (1 - DUCK_FLOOR) * rise
}

/**
 * The same pump, started on each lit 16th and open again at the next lit 16th.
 * An empty mask stays at unity.
 */
export function customDuckGain(beats: number, trigs: number, bpm: number): number {
  const mask = trigs & 0xffff
  if (mask === 0 || !(bpm > 0)) return 1
  const bar = 4
  const wrapped = ((beats % bar) + bar) % bar
  const steps: number[] = []
  for (let index = 0; index < DUCK_TRIGS; index += 1) {
    if ((mask & (1 << index)) !== 0) steps.push(index * 0.25)
  }
  const first = steps[0] ?? 0
  const last = steps[steps.length - 1] ?? 0
  let start = last - bar
  let end = first + bar
  for (const at of steps) {
    if (at <= wrapped + 1e-8) start = at
    else {
      end = at
      break
    }
  }
  return duckGain(wrapped - start, end - start, bpm)
}

function tempoBpm(state: DuckState, tempo: number): number {
  if (state.bpm >= 40 && state.bpm <= 300) return state.bpm
  if (tempo >= 20 && tempo <= 400) return tempo
  return 120
}

/**
 * Musical position for the duck. A transport bar wins. Otherwise the tempo grid
 * keeps moving from a fixed anchor, so a rate still ducks and the key does not
 * start a new cycle. `running` is only the fresh transport, used to quantize
 * other gestures onto a real bar.
 */
export function duckPosition(state: DuckState, now: number, tempo: number): { beats: number; bpm: number; running: boolean } {
  const bpm = tempoBpm(state, tempo)
  const transport = state.clocking && state.lastClockAt > 0
  if (transport) {
    return {
      beats: state.clockBeats + Math.max(0, now - state.lastClockAt) / 1000 * bpm / 60,
      bpm,
      running: now - state.lastClockAt < 500
    }
  }
  if (!(state.gridOrigin > 0)) state.gridOrigin = now
  return {
    beats: Math.max(0, now - state.gridOrigin) / 1000 * bpm / 60,
    bpm,
    running: false
  }
}

/**
 * Advance the bar from transport. Device messages win over the app's play clock
 * so an echoed clock is not counted twice. Start is the downbeat. The rate key
 * does not call this.
 */
export function noteDuckClock(
  state: DuckState,
  kind: 'start' | 'clock' | 'stop',
  now: number,
  source: 'device' | 'app'
): void {
  const deviceLive = state.deviceClockAt > 0 && now - state.deviceClockAt < 500
  if (source === 'app' && deviceLive) return
  if (kind === 'stop') {
    if (state.clocking && state.lastClockAt > 0) {
      const bpm = tempoBpm(state, state.bpm)
      const beats = state.clockBeats + Math.max(0, now - state.lastClockAt) / 1000 * bpm / 60
      state.gridOrigin = now - (beats * 60) / bpm * 1000
    }
    state.clocking = false
    state.lastClockAt = 0
    if (source === 'device') state.deviceClockAt = now
    return
  }
  if (kind === 'start') {
    state.clocking = true
    state.clockBeats = 0
    state.lastClockAt = now
    if (source === 'device') state.deviceClockAt = now
    return
  }
  if (!state.clocking) return
  const gap = state.lastClockAt > 0 ? now - state.lastClockAt : 0
  if (gap > 8 && gap < 80) {
    const bpm = 2500 / gap
    if (bpm >= 40 && bpm <= 300) state.bpm += (bpm - state.bpm) * 0.25
  }
  state.clockBeats += 1 / 24
  state.lastClockAt = now
  if (source === 'device') state.deviceClockAt = now
}

/** Select a rate, or clear it when that rate is already selected. The bar and the custom trigs stay put. */
export function toggleDuck(state: DuckState, rate: DuckRate): void {
  if (state.label === rate.label) {
    state.division = 0
    state.label = ''
    state.custom = false
    return
  }
  state.division = rate.beats
  state.label = rate.label
  state.custom = rate.custom
}
