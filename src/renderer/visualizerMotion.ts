export type Rgb = [number, number, number]

export type Appearance = 'dark' | 'light'

/** The six orbs at rest in dark mode. */
export const REST_COLORS: Rgb[] = [
  [50, 16, 79],
  [84, 39, 143],
  [142, 94, 162],
  [212, 80, 135],
  [214, 40, 40],
  [232, 93, 4]
]

/** The six orbs at rest in light mode. */
export const LIGHT_COLORS: Rgb[] = [
  [207, 234, 227],
  [163, 212, 217],
  [81, 178, 214],
  [27, 93, 172],
  [152, 172, 169],
  [249, 225, 180]
]

export function restColors(appearance: Appearance): Rgb[] {
  return appearance === 'light' ? LIGHT_COLORS : REST_COLORS
}

/** Six bands, low to high, in the range a Model:Cycles kit actually occupies. */
const BAND_HZ: [number, number][] = [
  [35, 90],
  [90, 200],
  [200, 500],
  [500, 1400],
  [1400, 4500],
  [4500, 14000]
]

export type Orb = {
  x: number
  y: number
  vx: number
  vy: number
  placed: boolean
  punch: number
  color: Rgb
  target: Rgb
  /** Shove direction. It walks a few degrees on each hit, then eases home. */
  aim: number
  aimSign: number
  aimLeg: number
  /** -1 is a low note, 1 is a high note. Drums leave this at rest. */
  pitch: number
  wanderX: number
  wanderY: number
  heading: number
  wandering: boolean
  wanderLeft: number
  wanderLeg: number
}

export function createOrbs(): Orb[] {
  return REST_COLORS.map((color, index) => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    placed: false,
    punch: 0,
    color: [...color] as Rgb,
    target: [...color] as Rgb,
    aim: restAim(index),
    aimSign: 1,
    aimLeg: index,
    pitch: 0,
    wanderX: 0,
    wanderY: 0,
    heading: index * 2.399963,
    wandering: true,
    wanderLeft: 2.1 + (index % 3) * 0.55,
    wanderLeg: index
  }))
}

/** 24 MIDI clocks per quarter note. Six clocks are one 16th. A 16-step bar is 96 clocks. */
export const CLOCKS_PER_BAR = 96

export type SequencerGrid = {
  clocks: number
  playing: boolean
  breath: number
}

export function createSequencerGrid(): SequencerGrid {
  return { clocks: 0, playing: false, breath: 0 }
}

/**
 * True on the downbeat. Play resets the bar. Each later group of 96 clocks is the next 1.
 * A clock that is not the 1 does not move the room, so a swung hit is not pulled onto the grid.
 */
export function hearTransport(grid: SequencerGrid, kind: 'start' | 'clock' | 'stop'): boolean {
  if (kind === 'stop') {
    grid.playing = false
    grid.clocks = 0
    return false
  }
  if (kind === 'start') {
    grid.clocks = 0
    grid.playing = true
    grid.breath = 1
    return true
  }
  if (!grid.playing) {
    grid.playing = true
    grid.clocks = 0
  }
  grid.clocks += 1
  if (grid.clocks % CLOCKS_PER_BAR !== 0) return false
  grid.breath = 1
  return true
}

/** The shared breath falls across the bar. It is not a per-hit hop. */
export function easeBreath(grid: SequencerGrid, dt: number): number {
  grid.breath *= Math.exp(-Math.max(0, dt) * 1.35)
  return grid.breath
}

/**
 * Factory seats, as a fraction of the safe picture. Kick is low, metal and hats are high,
 * and tone and chord sit in the middle. A loud mix does not drag the others along.
 */
const TRACK_SEAT: { x: number; y: number }[] = [
  { x: 0.5, y: 0.82 },
  { x: 0.26, y: 0.66 },
  { x: 0.72, y: 0.16 },
  { x: 0.78, y: 0.46 },
  { x: 0.3, y: 0.44 },
  { x: 0.52, y: 0.36 }
]

/**
 * How hard each circle is to move. The kick is heavy. Metal and the hat travel
 * farther and settle sooner. Tone and chord sit between those.
 * shove scales the hit. spring scales the return. damp scales how fast motion dies.
 */
const TRACK_BODY: { shove: number; spring: number; damp: number }[] = [
  { shove: 0.72, spring: 1.1, damp: 0.94 },
  { shove: 0.86, spring: 1.04, damp: 1 },
  { shove: 1.72, spring: 0.86, damp: 1.18 },
  { shove: 1.78, spring: 0.84, damp: 1.22 },
  { shove: 1, spring: 1.06, damp: 1.08 },
  { shove: 1, spring: 1.06, damp: 1.08 }
]

/** Degrees, kept small so a stream of hits turns without spinning into a new character. */
const AIM_STEP = [0.14, 0.2, 0.16, 0.24, 0.18]

function restAim(index: number): number {
  return Math.atan2(Math.sin(index * 2.1), Math.cos(index * 1.7 + 0.4))
}

function wrapAngle(delta: number): number {
  const turn = Math.PI * 2
  return delta - turn * Math.round(delta / turn)
}

function bodyFor(index: number): { shove: number; spring: number; damp: number } {
  return TRACK_BODY[index] ?? TRACK_BODY[0]
}

/** The seat is fixed. The slow drift lives on the circle, so it can pause and turn back. */
export function clusterHome(
  index: number,
  width: number,
  height: number,
  _now: number,
  _drive: number,
  breath = 0
): { x: number; y: number } {
  const span = Math.min(width, height)
  const padX = Math.min(width * 0.28, span * 0.24)
  const padY = Math.min(height * 0.26, span * 0.22)
  const seat = TRACK_SEAT[index] ?? TRACK_SEAT[0]
  const roomX = Math.max(0, width - padX * 2)
  const roomY = Math.max(0, height - padY * 2)
  const x = padX + roomX * seat.x
  const y = padY + roomY * seat.y - breath * span * 0.012
  return {
    x: Math.min(width - padX, Math.max(padX, x)),
    y: Math.min(height - padY, Math.max(padY, y))
  }
}

function legLength(index: number, leg: number, pause: boolean): number {
  const step = (index * 4 + leg * 5) % 9
  if (pause) return 1.15 + step * 0.18
  return 2.35 + (step % 5) * 0.4
}

/** Same reach the old seat sway used. The heading pauses, then turns back instead of looping. */
function stepWander(orb: Orb, index: number, dt: number, span: number): void {
  const reach = span * 0.034
  const speed = span * 0.0036
  orb.wanderLeft -= dt
  if (orb.wanderLeft <= 0) {
    orb.wanderLeg += 1
    const dist = Math.hypot(orb.wanderX, orb.wanderY)
    if (orb.wandering) {
      orb.wandering = false
      orb.wanderLeft = legLength(index, orb.wanderLeg, true)
    } else {
      orb.wandering = true
      orb.wanderLeft = legLength(index, orb.wanderLeg, false)
      if (dist > reach * 0.5) {
        const back = Math.atan2(-orb.wanderY, -orb.wanderX)
        const bend = orb.wanderLeg % 2 === 0 ? 0.5 : -0.38
        orb.heading = back + bend
      } else {
        orb.heading += 1.1 + (orb.wanderLeg % 4) * 0.18
      }
    }
  }
  if (!orb.wandering) return
  orb.wanderX += Math.cos(orb.heading) * speed * dt
  orb.wanderY += Math.sin(orb.heading) * speed * dt
  const dist = Math.hypot(orb.wanderX, orb.wanderY)
  if (dist > reach && dist > 0) {
    orb.wanderX *= reach / dist
    orb.wanderY *= reach / dist
    orb.heading = Math.atan2(-orb.wanderY, -orb.wanderX)
  }
}

export function randomSphereColors(random: () => number = Math.random): Rgb[] {
  const origin = random() * 360
  return Array.from({ length: 6 }, (_, index) => {
    const hue = (origin + index * 57 + (random() - 0.5) * 28 + 360) % 360
    const saturation = 0.58 + random() * 0.32
    const lightness = 0.56 + random() * 0.14
    return hslToRgb(hue, saturation, lightness)
  })
}

export function paletteForProgram(program: number): Rgb[] {
  return randomSphereColors(mulberry32(program * 997 + 13))
}

export type ColorHistory = { stack: Rgb[][]; index: number }

export function createColorHistory(): ColorHistory {
  return { stack: [REST_COLORS.map((color) => [...color] as Rgb)], index: 0 }
}

export function historyCurrent(history: ColorHistory): Rgb[] {
  return history.stack[history.index] ?? REST_COLORS
}

export function redoColors(history: ColorHistory, colors: Rgb[]): void {
  history.stack = history.stack.slice(0, history.index + 1)
  history.stack.push(colors.map((color) => [...color] as Rgb))
  if (history.stack.length > 32) history.stack.shift()
  history.index = history.stack.length - 1
}

export function resetColorHistory(history: ColorHistory, appearance: Appearance): void {
  history.stack = [restColors(appearance).map((color) => [...color] as Rgb)]
  history.index = 0
}

export function undoColors(history: ColorHistory): boolean {
  if (history.index <= 0) return false
  history.index -= 1
  return true
}

export function assignColors(orbs: Orb[], colors: Rgb[]): void {
  orbs.forEach((orb, index) => {
    const next = colors[index] ?? colors[0]
    if (!next) return
    orb.target = [...next] as Rgb
  })
}

/** A pattern program change should reshuffle, including a repeat after a short gap. */
export function patternShuffle(program: number, last: { program: number; at: number } | null, now: number): boolean {
  if (!Number.isInteger(program) || program < 0 || program > 127) return false
  if (last && last.program === program && now - last.at < 400) return false
  return true
}

/** The output channel of a track is that sphere. -1 when the note is not one of the six tracks. */
export function trackForNote(channel: number, trackChannels: readonly number[]): number {
  return trackChannels.indexOf(channel)
}

export function waveformRms(time: Uint8Array): number {
  if (time.length === 0) return 0
  let sum = 0
  for (let i = 0; i < time.length; i += 1) {
    const sample = ((time[i] ?? 128) - 128) / 128
    sum += sample * sample
  }
  return Math.sqrt(sum / time.length)
}

export function bandLevels(freq: Uint8Array, sampleRate: number): number[] {
  const bands = [0, 0, 0, 0, 0, 0]
  if (freq.length === 0 || sampleRate <= 0) return bands
  const fftSize = freq.length * 2
  const hzPerBin = sampleRate / fftSize
  for (let i = 0; i < 6; i += 1) {
    const range = BAND_HZ[i] ?? [0, 1]
    const start = Math.max(1, Math.floor(range[0] / hzPerBin))
    const end = Math.min(freq.length, Math.max(start + 1, Math.ceil(range[1] / hzPerBin)))
    let sum = 0
    let peak = 0
    for (let bin = start; bin < end; bin += 1) {
      const value = freq[bin] ?? 0
      sum += value
      if (value > peak) peak = value
    }
    const mean = sum / (end - start) / 255
    bands[i] = mean * 0.35 + (peak / 255) * 0.65
  }
  return bands
}

/**
 * Place the six frequency bands on the six tracks: kick, snare, metal, perc, tone, chord.
 * A band far below the loudest hit stays an ember, so the circles keep their size for the hits.
 */
export function trackLevels(bands: readonly number[]): number[] {
  const ordered = [
    bands[0] ?? 0,
    bands[1] ?? 0,
    bands[5] ?? 0,
    bands[4] ?? 0,
    bands[2] ?? 0,
    bands[3] ?? 0
  ]
  const peak = ordered.reduce((max, level) => Math.max(max, level), 0)
  if (peak <= 0) return ordered
  return ordered.map((level) => (level / peak < 0.45 ? 0 : level))
}

/** Time-domain samples around silence. Quiet playback stays small; digital silence stays flat. */
export function waveformPoints(wave: Uint8Array): number[] {
  const shaped = new Array<number>(wave.length).fill(0)
  let peak = 0
  for (let i = 0; i < wave.length; i += 1) {
    const sample = ((wave[i] ?? 128) - 128) / 128
    shaped[i] = sample
    peak = Math.max(peak, Math.abs(sample))
  }
  if (peak < 0.012) return shaped.map(() => 0)
  return shaped
}

/** Finer log-spaced bands so a new kit or a new pitch reads as a different mix. */
export function spectrumBins(freq: Uint8Array, sampleRate: number, count = 24): number[] {
  const bins = Array.from({ length: count }, () => 0)
  if (freq.length === 0 || sampleRate <= 0) return bins
  const hzPerBin = sampleRate / (freq.length * 2)
  const minHz = 40
  const maxHz = Math.min(14000, sampleRate / 2)
  const logMin = Math.log(minHz)
  const logMax = Math.log(maxHz)
  for (let i = 0; i < count; i += 1) {
    const low = Math.exp(logMin + ((logMax - logMin) * i) / count)
    const high = Math.exp(logMin + ((logMax - logMin) * (i + 1)) / count)
    const start = Math.max(1, Math.floor(low / hzPerBin))
    const end = Math.min(freq.length, Math.max(start + 1, Math.ceil(high / hzPerBin)))
    let peak = 0
    for (let bin = start; bin < end; bin += 1) {
      const value = freq[bin] ?? 0
      if (value > peak) peak = value
    }
    bins[i] = peak / 255
  }
  return bins
}

/** A sudden rise in one band. Steady tone and noise under the threshold stay at 0. */
export function bandOnset(previous: number, raw: number): number {
  const jump = raw - previous
  if (jump < 0.035) return 0
  return Math.min(1, (jump - 0.035) / 0.2)
}

/** Map a waveform level to 0 when the input is effectively silent. */
export function audibleAmount(rms: number, bandMean: number): number {
  const fromWave = rms <= 0.008 ? 0 : Math.min(1, ((rms - 0.008) / 0.09) ** 0.45)
  const fromBands = bandMean <= 0.02 ? 0 : Math.min(1, ((bandMean - 0.02) / 0.16) ** 0.55)
  return Math.max(fromWave, fromBands)
}

/** Full-travel flatten. The unpressed edge of the circle stays put. */
export const ORB_SQUASH = 1 / 6

export type OrbPress = {
  x: number
  y: number
  scaleX: number
  scaleY: number
}

/** Press a circle from below when the high pass is up, and from above when the low pass is down. */
export function orbPress(x: number, y: number, radius: number, position: number, punch = 0, drama = 1): OrbPress {
  const amount = Math.min(1, Math.abs(position))
  const give = Math.min(1, Math.max(0, punch)) * 0.35
  const squash = amount * (1 - give) * ORB_SQUASH * drama
  const shift = radius * squash
  return {
    x,
    y: position > 0 ? y - shift : position < 0 ? y + shift : y,
    scaleX: 1 + squash * 0.35,
    scaleY: 1 - squash
  }
}

export function follow(current: number, target: number, dt: number, rise: number, fall: number): number {
  const rate = target > current ? rise : fall
  return current + (target - current) * Math.min(1, Math.max(0, dt) * rate)
}

const STEP_BINS = 16
const WINDOW_FRAMES = 128

export type GroovePrint = {
  last: number[]
  width: number
  deltas: number[]
  tone: number[]
  latchedTone: number[]
  latched: number[]
  notes: number[]
  latchedNotes: number[]
  clockBins: number[]
  latchedClock: number[]
  run: number
  gap: number
  settle: number
  toneWait: number
  rhythmWait: number
  noteWait: number
  clockWait: number
  clocks: number
  appliedClocks: number
  clockMark: number
  step: number
  clockReady: boolean
  clockFilled: boolean
  clockDue: boolean
  clockShapeHold: number[]
  lastClockShape: number[]
  clockDistance: number
}

export function createGroovePrint(): GroovePrint {
  return {
    last: [],
    width: 0,
    deltas: [],
    tone: [],
    latchedTone: [],
    latched: [],
    notes: [],
    latchedNotes: [],
    clockBins: emptySteps(),
    latchedClock: [],
    run: 0,
    gap: 0,
    settle: 0,
    toneWait: 0,
    rhythmWait: 0,
    noteWait: 0,
    clockWait: 0,
    clocks: 0,
    appliedClocks: 0,
    clockMark: -10,
    step: 0,
    clockReady: false,
    clockFilled: false,
    clockDue: false,
    clockShapeHold: [],
    lastClockShape: [],
    clockDistance: 0
  }
}

/** One MIDI clock from the Model:Cycles. Six clocks are one sequencer step. */
export function hearClock(print: GroovePrint): void {
  print.clocks += 1
}

/** Any note the sequencer plays, on whatever channel it uses. */
export function hearNote(print: GroovePrint, note: number): void {
  print.notes.push(((note % 12) + 12) % 12)
  if (print.notes.length > 24) print.notes.shift()
}

export function holdGroove(print: GroovePrint, seconds = 2.4): void {
  print.settle = Math.max(print.settle, seconds)
  print.toneWait = 0
  print.rhythmWait = 0
  print.noteWait = 0
  print.clockWait = 0
}

/**
 * True once when the playing pattern changes.
 * The latch is the recent sound: which frequencies hit in each slice of the last two seconds.
 * A new kit moves the tone. The same kit in a new rhythm moves those slices.
 * Notes and the sequencer clock count too. A program change is handled separately and is immediate.
 */
export function noticePatternChange(print: GroovePrint, bands: number[], drive: number, dt: number): boolean {
  print.settle = Math.max(0, print.settle - dt)
  print.run += dt
  if (drive < 0.06) print.gap += dt
  else print.gap = 0
  if (print.gap > 2.4) {
    print.deltas = []
    print.latched = []
    print.toneWait = 0
    print.rhythmWait = 0
    print.noteWait = 0
    print.clockWait = 0
    return false
  }

  const flux = rememberBands(print, bands)
  rememberClock(print, flux)

  const learning = print.run < 1.8 || print.deltas.length < WINDOW_FRAMES * Math.max(1, print.width)
  const toneDistance = toneGap(print, bands, drive, dt)
  const rhythmDistance = rhythmGap(print)
  const noteDistance = noteGap(print)
  const clockDistance = clockGap(print)

  if (learning || print.settle > 0) {
    print.latchedTone = [...print.tone]
    const rhythm = rhythmNow(print)
    if (rhythm.length > 0) print.latched = rhythm
    print.latchedNotes = noteHistogram(print.notes)
    print.clockDistance = 0
    print.toneWait = 0
    print.rhythmWait = 0
    print.noteWait = 0
    print.clockWait = 0
    return false
  }

  print.toneWait = accumulate(print.toneWait, toneDistance, 0.08, dt)
  print.rhythmWait = accumulate(print.rhythmWait, rhythmDistance, 0.2, dt)
  print.noteWait = accumulate(print.noteWait, noteDistance, 0.28, dt)
  print.clockWait = accumulate(print.clockWait, clockDistance, 0.16, dt)
  glue(print.latchedTone, print.tone, toneDistance, 0.08, dt)
  if (rhythmDistance <= 0.2) {
    const rhythm = rhythmNow(print)
    if (rhythm.length === print.latched.length) glue(print.latched, rhythm, rhythmDistance, 0.1, dt)
  }

  if (print.toneWait < 0.4 && print.rhythmWait < 0.4 && print.noteWait < 0.35 && print.clockWait < 0.35) return false
  print.latchedTone = [...print.tone]
  const rhythm = rhythmNow(print)
  if (rhythm.length > 0) print.latched = rhythm
  print.latchedNotes = noteHistogram(print.notes)
  if (print.lastClockShape.length === STEP_BINS) print.latchedClock = [...print.lastClockShape]
  print.clockDistance = 0
  print.toneWait = 0
  print.rhythmWait = 0
  print.noteWait = 0
  print.clockWait = 0
  print.settle = 2.2
  return true
}

function emptySteps(): number[] {
  return Array.from({ length: STEP_BINS }, () => 0)
}

function rememberBands(print: GroovePrint, bands: number[]): number {
  if (print.width !== bands.length || print.last.length !== bands.length) {
    print.width = bands.length
    print.last = [...bands]
    print.deltas = []
    print.latched = []
    print.tone = []
    print.latchedTone = []
    return 0
  }
  let flux = 0
  const frame: number[] = []
  for (let i = 0; i < bands.length; i += 1) {
    const rise = Math.max(0, (bands[i] ?? 0) - (print.last[i] ?? 0))
    frame.push(rise)
    flux += rise
  }
  print.last = [...bands]
  print.deltas.push(...frame)
  const cap = 200 * bands.length
  if (print.deltas.length > cap) print.deltas.splice(0, print.deltas.length - cap)
  return flux
}

function rememberClock(print: GroovePrint, flux: number): void {
  if (print.clocks === print.appliedClocks) {
    if (print.clockReady && print.run - print.clockMark < 0.5) print.clockBins[print.step] = (print.clockBins[print.step] ?? 0) + flux
    return
  }
  print.clockMark = print.run
  const next = Math.floor(print.clocks / 6) % STEP_BINS
  if (print.clockReady && next < print.step) {
    if (print.clockFilled) {
      print.clockShapeHold = [...print.clockBins]
      print.clockDue = true
    }
    print.clockFilled = true
    print.clockBins = emptySteps()
  }
  print.step = next
  print.clockReady = true
  print.appliedClocks = print.clocks
  print.clockBins[print.step] = (print.clockBins[print.step] ?? 0) + flux
}

function toneGap(print: GroovePrint, bands: number[], drive: number, dt: number): number {
  if (drive < 0.06) return 0
  const mix = normalize(bands)
  if (mix.length === 0) return 0
  if (print.tone.length !== mix.length) {
    print.tone = [...mix]
    print.latchedTone = [...mix]
    return 0
  }
  const rate = Math.min(1, dt * 1.35)
  for (let i = 0; i < mix.length; i += 1) print.tone[i] = (print.tone[i] ?? 0) * (1 - rate) + (mix[i] ?? 0) * rate
  if (print.latchedTone.length !== print.tone.length) {
    print.latchedTone = [...print.tone]
    return 0
  }
  return spectralDistance(print.latchedTone, print.tone)
}

function rhythmNow(print: GroovePrint): number[] {
  const width = print.width
  if (width <= 0 || print.deltas.length < WINDOW_FRAMES * width) return []
  const start = print.deltas.length - WINDOW_FRAMES * width
  const levels: number[] = []
  let mean = 0
  for (let frame = 0; frame < WINDOW_FRAMES; frame += 1) {
    let sum = 0
    for (let band = 0; band < width; band += 1) sum += print.deltas[start + frame * width + band] ?? 0
    levels.push(sum)
  }
  const envelope: number[] = []
  let followed = 0
  for (const level of levels) {
    followed = followed * 0.45 + level * 0.55
    envelope.push(followed)
    mean += followed
  }
  mean /= WINDOW_FRAMES
  const gate = Math.max(0.045, mean * 1.5)
  const times: number[] = []
  for (let index = 1; index < envelope.length - 1; index += 1) {
    const value = envelope[index] ?? 0
    if (value < gate || value < (envelope[index - 1] ?? 0) || value < (envelope[index + 1] ?? 0)) continue
    const previous = times[times.length - 1]
    if (previous == null || index - previous > 4) times.push(index)
  }
  const bins = Array.from({ length: 8 }, () => 0)
  for (let index = 1; index < times.length; index += 1) {
    const gap = (times[index] ?? 0) - (times[index - 1] ?? 0)
    const bin = Math.max(0, Math.min(7, Math.round(Math.log2(Math.max(1, gap) / 4) * 2)))
    bins[bin] += 1
  }
  return bins
}

function rhythmGap(print: GroovePrint): number {
  const rhythm = rhythmNow(print)
  if (rhythm.length === 0 || shapeEnergy(rhythm) < 2) return 0
  if (print.latched.length !== rhythm.length || shapeEnergy(print.latched) < 2) {
    print.latched = rhythm
    return 0
  }
  return profileDistance(print.latched, rhythm)
}

function shapeEnergy(values: number[]): number {
  let sum = 0
  for (const value of values) sum += value
  return sum
}

function noteGap(print: GroovePrint): number {
  if (print.notes.length < 8) return 0
  const current = noteHistogram(print.notes)
  if (print.latchedNotes.length !== 12) {
    print.latchedNotes = current
    return 0
  }
  return profileDistance(print.latchedNotes, current)
}

function clockGap(print: GroovePrint): number {
  if (!print.clockDue) return print.clockDistance
  const shape = print.clockShapeHold
  print.clockDue = false
  print.clockShapeHold = []
  if (shape.length !== STEP_BINS) return print.clockDistance
  print.lastClockShape = [...shape]
  if (print.latchedClock.length !== STEP_BINS) {
    print.latchedClock = [...shape]
    print.clockDistance = 0
    return 0
  }
  const distance = profileDistance(print.latchedClock, shape)
  if (distance <= 0.16) {
    print.latchedClock = shape.map((value, index) => (print.latchedClock[index] ?? 0) * 0.5 + value * 0.5)
    print.clockDistance = 0
    return 0
  }
  print.clockDistance = distance
  return distance
}

function noteHistogram(notes: number[]): number[] {
  const bins = Array.from({ length: 12 }, () => 0)
  for (const note of notes) bins[note] = (bins[note] ?? 0) + 1
  return bins
}

function accumulate(wait: number, distance: number, threshold: number, dt: number): number {
  if (distance > threshold) return wait + dt
  return Math.max(0, wait - dt * 0.65)
}

function glue(latched: number[], current: number[], distance: number, threshold: number, dt: number): void {
  if (distance > threshold || latched.length !== current.length || latched.length === 0) return
  const rate = Math.min(1, dt * 1.8)
  for (let i = 0; i < latched.length; i += 1) latched[i] = (latched[i] ?? 0) * (1 - rate) + (current[i] ?? 0) * rate
}

function normalize(values: number[]): number[] {
  let sum = 0
  for (const value of values) sum += Math.max(0, value)
  if (sum < 1e-5) return []
  return values.map((value) => Math.max(0, value) / sum)
}

function profileDistance(a: number[], b: number[]): number {
  let leftSum = 0
  let rightSum = 0
  for (let i = 0; i < a.length; i += 1) {
    leftSum += a[i] ?? 0
    rightSum += b[i] ?? 0
  }
  if (leftSum < 1e-6 || rightSum < 1e-6) return 0
  let distance = 0
  for (let i = 0; i < a.length; i += 1) {
    distance += Math.abs((a[i] ?? 0) / leftSum - (b[i] ?? 0) / rightSum)
  }
  return distance / 2
}

export function stepOrb(
  orb: Orb,
  index: number,
  dt: number,
  home: { x: number; y: number },
  _drive: number,
  energy: number,
  hit: number,
  span: number,
  _now: number,
  frameWidth = 0,
  frameHeight = 0,
  breath = 0
): number {
  if (!orb.placed) {
    orb.x = home.x
    orb.y = home.y
    orb.placed = true
  }
  const own = Math.min(1, Math.max(0, energy))
  const body = bodyFor(index)
  stepWander(orb, index, dt, span)
  const homeAim = restAim(index)
  if (hit > 0.05) {
    const step = AIM_STEP[orb.aimLeg % AIM_STEP.length] ?? 0.16
    orb.aim += orb.aimSign * step
    orb.aimLeg += 1
    const swung = wrapAngle(orb.aim - homeAim)
    if (Math.abs(swung) > 0.58) {
      orb.aim = homeAim + Math.sign(swung) * 0.46
      orb.aimSign = -Math.sign(swung) || 1
    }
    const scale = hit * span * 0.1 * body.shove
    const lift = index >= 4 ? orb.pitch * 0.16 * scale : 0
    orb.vx += Math.cos(orb.aim) * scale
    orb.vy += Math.sin(orb.aim) * scale - lift
    orb.punch = Math.max(orb.punch, Math.min(1, hit))
  }
  const eased = wrapAngle(orb.aim - homeAim) * Math.exp(-dt * 0.7)
  orb.aim = homeAim + eased
  orb.punch *= Math.exp(-dt * 9)
  const tx = home.x + orb.wanderX
  const ty = home.y + orb.wanderY - energy * span * 0.02
  const spring = (0.85 + (1 - own) * 1.15) * body.spring
  orb.vx += (tx - orb.x) * spring * dt
  orb.vy += (ty - orb.y) * spring * dt
  const damp = Math.exp(-dt * (1.8 + (1 - own) * 1.6) * body.damp)
  orb.vx *= damp
  orb.vy *= damp
  const maxSpeed = span * 0.42
  const speed = Math.hypot(orb.vx, orb.vy)
  if (speed > maxSpeed) {
    orb.vx *= maxSpeed / speed
    orb.vy *= maxSpeed / speed
  }
  orb.x += orb.vx * dt
  orb.y += orb.vy * dt
  const glow = span * (0.055 + Math.min(0.34, energy * 0.42 + orb.punch * 0.18) + breath * 0.015)
  const roam = span * (0.07 + own * 0.06)
  let minX = home.x - roam
  let maxX = home.x + roam
  let minY = home.y - roam
  let maxY = home.y + roam
  if (frameWidth > 0 && frameHeight > 0) {
    const edgeX = Math.min(frameWidth * 0.34, glow * 0.55 + span * 0.1)
    const edgeY = Math.min(frameHeight * 0.34, glow * 0.55 + span * 0.1)
    const screenMinX = edgeX
    const screenMaxX = Math.max(edgeX, frameWidth - edgeX)
    const screenMinY = edgeY
    const screenMaxY = Math.max(edgeY, frameHeight - edgeY)
    minX = Math.min(screenMaxX, Math.max(screenMinX, minX))
    maxX = Math.min(screenMaxX, Math.max(screenMinX, maxX))
    minY = Math.min(screenMaxY, Math.max(screenMinY, minY))
    maxY = Math.min(screenMaxY, Math.max(screenMinY, maxY))
  }
  if (orb.x < minX) {
    orb.x = minX
    orb.vx = Math.abs(orb.vx) * 0.2
  }
  if (orb.x > maxX) {
    orb.x = maxX
    orb.vx = -Math.abs(orb.vx) * 0.2
  }
  if (orb.y < minY) {
    orb.y = minY
    orb.vy = Math.abs(orb.vy) * 0.2
  }
  if (orb.y > maxY) {
    orb.y = maxY
    orb.vy = -Math.abs(orb.vy) * 0.2
  }
  const mix = Math.min(1, dt * 7)
  for (let channel = 0; channel < 3; channel += 1) {
    orb.color[channel] += ((orb.target[channel] ?? 0) - (orb.color[channel] ?? 0)) * mix
  }
  return glow
}

function spectralDistance(a: number[], b: number[]): number {
  let dot = 0
  let aa = 0
  let bb = 0
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    dot += left * right
    aa += left * left
    bb += right * right
  }
  const denom = Math.sqrt(aa) * Math.sqrt(bb)
  if (denom < 1e-6) return 0
  return 1 - dot / denom
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const section = hue / 60
  const match = lightness - chroma / 2
  const x = chroma * (1 - Math.abs((section % 2) - 1))
  const channels =
    section < 1
      ? [chroma, x, 0]
      : section < 2
        ? [x, chroma, 0]
        : section < 3
          ? [0, chroma, x]
          : section < 4
            ? [0, x, chroma]
            : section < 5
              ? [x, 0, chroma]
              : [chroma, 0, x]
  return channels.map((channel) => Math.round((channel + match) * 255)) as Rgb
}
