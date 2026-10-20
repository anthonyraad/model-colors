/** Tempo-synced stutter. The division is in quarter-note beats. */
export const STUTTER_RATES = [
  { key: 'a', label: '1/32', beats: 0.125, custom: false },
  { key: 's', label: '1/16', beats: 0.25, custom: false },
  { key: 'd', label: '1/8 triplet', beats: 1 / 3, custom: false },
  { key: 'f', label: '1/8', beats: 0.5, custom: false },
  { key: 'g', label: '1/4', beats: 1, custom: false },
  { key: 'h', label: 'Custom', beats: 0, custom: true }
] as const

/** One bar of 32nd-note trigs. Bit 0 is the downbeat. */
export const STUTTER_TRIGS = 32

export type StutterRate = (typeof STUTTER_RATES)[number]

export type StutterCommand = {
  division: number
  bpm: number
  beats: number
  /** False leaves the output untouched. A selected rate stays on. */
  running: boolean
  /** True copies the musical beat so the repeat stays on the grid. */
  seek: boolean
  /** H follows the lit trigs instead of an even division. */
  custom: boolean
  /** Bit mask of the 32 custom trigs. Bit 31 is step 32. */
  trigs: number
}

export type StutterState = {
  division: number
  label: string
  /** The H key. The lit trigs decide where each repeat starts. */
  custom: boolean
  /** Bit mask of the 32 custom trigs. Kept when the rate is turned off. */
  trigs: number
}

export function createStutterState(): StutterState {
  return { division: 0, label: '', custom: false, trigs: 0 }
}

export function stutterActive(state: StutterState): boolean {
  return state.custom || state.division > 0
}

/** Flip one of the 32 custom trigs. Index 0 is the downbeat. */
export function toggleStutterTrig(mask: number, index: number): number {
  const bits = mask | 0
  if (index < 0 || index >= STUTTER_TRIGS) return bits
  return (bits ^ (1 << index)) | 0
}

export function stutterRate(key: string): StutterRate | null {
  const name = key.toLowerCase()
  return STUTTER_RATES.find((rate) => rate.key === name) ?? null
}

/** 0 at a grid point, 1 at the next one. The rate key does not move this. */
export function stutterPhase(beats: number, divisionBeats: number): number {
  if (!(divisionBeats > 0)) return 0
  const wrapped = ((beats % divisionBeats) + divisionBeats) % divisionBeats
  return wrapped / divisionBeats
}

/**
 * Full presence on the grid point, then a fall so each repeat reads as a hit.
 * Unity when the stutter is off.
 */
export function stutterGate(beats: number, divisionBeats: number, bpm: number): number {
  if (!(divisionBeats > 0) || !(bpm > 0)) return 1
  const cycle = (divisionBeats * 60) / bpm
  const seconds = stutterPhase(beats, divisionBeats) * cycle
  const open = cycle * 0.42
  if (seconds <= open) return 1
  const release = Math.max(0.008, cycle * 0.2)
  return 0.12 + 0.88 * Math.exp(-(seconds - open) / release)
}

/**
 * Where the current custom repeat sits.
 * `into` is how far past the lit step we are. `span` runs to the next lit step.
 * An empty mask has no repeat.
 */
export function customStutterSpan(beats: number, trigs: number): { into: number; span: number } | null {
  const mask = trigs | 0
  if (mask === 0) return null
  const bar = 4
  const wrapped = ((beats % bar) + bar) % bar
  const steps: number[] = []
  for (let index = 0; index < STUTTER_TRIGS; index += 1) {
    if ((mask & (1 << index)) !== 0) steps.push(index * 0.125)
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
  const span = end - start
  if (!(span > 0)) return null
  return { into: wrapped - start, span }
}

/** The stutter pulse, restarted on each lit 32nd. An empty mask stays open. */
export function customStutterGate(beats: number, trigs: number, bpm: number): number {
  const place = customStutterSpan(beats, trigs)
  if (!place) return 1
  return stutterGate(place.into, place.span, bpm)
}

/** Select a rate, or clear it when that rate is already selected. The bar and the custom trigs stay put. */
export function toggleStutter(state: StutterState, rate: StutterRate): void {
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
