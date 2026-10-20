/** Film treatments for the six insert slots. Each one is drawn only while that slot's look is on. */

export type Highlight = {
  x: number
  y: number
  radius: number
  amount: number
  punch: number
  color: [number, number, number]
}

export type TapeLook = {
  cooldownUntil: number
  jitterUntil: number
  jitterX: number
  tearUntil: number
  tearY: number
  tearH: number
  tearX: number
  dropUntil: number
  dropY: number
  dropH: number
}

export type DirtSpeck = {
  x: number
  y: number
  r: number
  alpha: number
  phase: number
  smear: boolean
  heading: number
  speed: number
  turnAt: number
}

export function createTapeLook(): TapeLook {
  return {
    cooldownUntil: 0,
    jitterUntil: 0,
    jitterX: 0,
    tearUntil: 0,
    tearY: 0,
    tearH: 0,
    tearX: 0,
    dropUntil: 0,
    dropY: 0,
    dropH: 0
  }
}

/** Air and presence, the top two bands of the kit. */
export function highFrequency(bands: readonly number[]): number {
  const body = bands[4] ?? 0
  const air = bands[5] ?? 0
  return Math.min(1, Math.max(0, body * 0.35 + air * 0.65))
}

/** Quiet film still has grain. Hats and metal thicken it. */
export function grainAlpha(high: number): number {
  const level = Math.min(1, Math.max(0, high))
  return 0.22 + level * 0.46
}

/**
 * Exposure for one frame of grain.
 * Most frames stay near the current coat. A few dip, and a few flash.
 */
export function grainFlicker(seed: number): number {
  const n = ((seed >>> 0) % 4096) / 4096
  if (n < 0.14) return 0.48 + n
  if (n > 0.88) return 1.02 + (n - 0.88) * 1.15
  const wobble = ((Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0) / 4294967296
  return 0.84 + wobble * 0.22
}

/** How much of the flat grain field is ink. Quiet is sparse. Loud and bright fills in. */
export function flatGrainDensity(drive: number, high: number): number {
  const loud = Math.min(1, Math.max(0, drive))
  const air = Math.min(1, Math.max(0, high))
  return 0.04 + loud * 0.11 + air * 0.06
}

/**
 * Light mode blinks the circle on for the open part of each stutter and off for the rest.
 * Dark mode keeps the size pulse.
 */
export function stutterPresence(chop: number, light: boolean): { scale: number; shown: boolean } {
  const level = Math.min(1, Math.max(0, chop))
  if (!light) return { scale: 0.22 + 0.78 * level, shown: true }
  return { scale: 1, shown: level >= 1 }
}

/** Light-mode braid coat. Some steps nearly clear, so the field flickers instead of holding. */
export function flatGrainCoat(seed: number): number {
  const n = ((seed >>> 0) % 4096) / 4096
  if (n < 0.28) return 0.22
  if (n > 0.86) return 1
  return 0.42 + (n - 0.28) * 0.7
}

/**
 * How far a look has come in.
 * Zero bars is already full. One, two, and four bars rise across that many bars.
 */
export function lookFade(bars: number, bpm: number, elapsedMs: number): number {
  if (bars !== 1 && bars !== 2 && bars !== 4) return 1
  const tempo = bpm < 1 ? 120 : bpm
  const seconds = (bars * 4 * 60) / tempo
  if (seconds <= 0) return 1
  return Math.min(1, Math.max(0, elapsedMs / 1000 / seconds))
}

/** One look's fade. `from` is the level at the moment it was last toggled. */
export type LookRamp = {
  on: boolean
  at: number
  bars: number
  bpm: number
  from: number
}

/** The level of a look, rising toward 1 or falling back toward 0. */
export function lookLevel(ramp: LookRamp, now: number): number {
  const target = ramp.on ? 1 : 0
  const progress = lookFade(ramp.bars, ramp.bpm, Math.max(0, now - ramp.at))
  return ramp.from + (target - ramp.from) * progress
}

/** Advance a look when it is toggled. The bar count is the fade in, or the fade back. */
export function stepLook(ramp: LookRamp, on: boolean, bars: number, bpm: number, now: number): number {
  if (ramp.on !== on) {
    ramp.from = lookLevel(ramp, now)
    ramp.on = on
    ramp.at = now
    ramp.bars = bars === 1 || bars === 2 || bars === 4 ? bars : 0
    ramp.bpm = bpm < 1 ? 120 : bpm
  }
  return lookLevel(ramp, now)
}

/**
 * Loud hits may start a short jitter, a torn line, or a dropout.
 * `roll` is 0–1. Nothing fires under the threshold or inside the cooldown.
 */
export function stepTape(tape: TapeLook, now: number, transient: number, roll: number, span: number): TapeLook {
  if (transient < 0.42 || now < tape.cooldownUntil) return tape
  const next: TapeLook = { ...tape, cooldownUntil: now + 780 }
  const chance = Math.min(1, Math.max(0, roll))
  if (chance < 0.82) {
    next.jitterUntil = now + 100
    next.jitterX = (chance - 0.35) * Math.max(8, span * 0.008)
  }
  if (chance > 0.38 && chance < 0.88) {
    next.tearUntil = now + 80
    next.tearY = 0.12 + chance * 0.7
    next.tearH = 0.008 + (1 - chance) * 0.012
    next.tearX = (chance - 0.55) * Math.max(10, span * 0.012)
  }
  if (chance > 0.58) {
    next.dropUntil = now + 130
    next.dropY = (chance * 0.72) % 1
    next.dropH = 0.018 + chance * 0.028
  }
  return next
}

export function createDirt(count = 36): DirtSpeck[] {
  const rand = mulberry32(0xc0ffee)
  return Array.from({ length: count }, (_, index) => {
    const smear = index < 7
    return {
      x: 0.08 + rand() * 0.84,
      y: 0.08 + rand() * 0.84,
      r: smear ? 16 + rand() * 46 : 0.5 + rand() * 1.8,
      alpha: smear ? 0.03 + rand() * 0.025 : 0.18 + rand() * 0.4,
      phase: rand() * Math.PI * 2,
      smear,
      heading: rand() * Math.PI * 2,
      speed: smear ? 0.018 + rand() * 0.02 : 0.06 + rand() * 0.09,
      turnAt: 500 + rand() * 1400
    }
  })
}

/** Dust wanders and changes direction. Smudges slide more slowly. */
export function stepDirt(specks: DirtSpeck[], now: number, dt: number, random: () => number = Math.random): void {
  const step = Math.min(0.05, Math.max(0, dt))
  for (const speck of specks) {
    if (now >= speck.turnAt) {
      speck.heading += (random() - 0.5) * (speck.smear ? 1.6 : 3.1)
      speck.speed = speck.smear ? 0.014 + random() * 0.028 : 0.05 + random() * 0.11
      speck.turnAt = now + (speck.smear ? 1200 : 280) + random() * (speck.smear ? 1600 : 800)
    }
    const curve = Math.sin(now / 360 + speck.phase) * (speck.smear ? 0.25 : 0.7)
    const angle = speck.heading + curve
    speck.x += Math.cos(angle) * speck.speed * step
    speck.y += Math.sin(angle) * speck.speed * step * 0.86
    if (speck.x < 0.04 || speck.x > 0.96) {
      speck.x = Math.min(0.96, Math.max(0.04, speck.x))
      speck.heading = Math.PI - speck.heading
    }
    if (speck.y < 0.04 || speck.y > 0.96) {
      speck.y = Math.min(0.96, Math.max(0.04, speck.y))
      speck.heading = -speck.heading
    }
  }
}

export function writeGrain(context: CanvasRenderingContext2D, high: number, seed: number, flat = false, density = 0.1): void {
  const { width, height } = context.canvas
  const image = context.createImageData(width, height)
  const data = image.data
  const spark = 0.03 + Math.min(1, Math.max(0, high)) * 0.16
  const fill = Math.min(0.28, Math.max(0.004, density))
  let state = seed >>> 0
  for (let i = 0; i < data.length; i += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const n = state / 4294967296
    if (flat) {
      const on = n > 1 - fill
      data[i] = 20
      data[i + 1] = 20
      data[i + 2] = 20
      data[i + 3] = on ? 255 : 0
      continue
    }
    const hot = n > 1 - spark
    const lift = hot ? 210 + n * 45 : 28 + n * 150
    data[i] = lift
    data[i + 1] = lift * 0.86
    data[i + 2] = lift * 0.68
    data[i + 3] = hot ? 150 : 36 + n * 70
  }
  context.putImageData(image, 0, 0)
}

export function paintHalation(
  context: CanvasRenderingContext2D,
  bloom: CanvasRenderingContext2D,
  glows: readonly Highlight[],
  width: number,
  height: number,
  flat = false
): void {
  if (flat) {
    context.save()
    context.globalCompositeOperation = 'source-over'
    context.strokeStyle = '#141414'
    for (const glow of glows) {
      if (glow.radius < 1) continue
      context.lineWidth = Math.max(4, glow.radius * 0.12)
      context.beginPath()
      context.arc(glow.x, glow.y, glow.radius + context.lineWidth * 0.6, 0, Math.PI * 2)
      context.stroke()
    }
    context.restore()
    return
  }
  const surface = bloom.canvas
  bloom.clearRect(0, 0, surface.width, surface.height)
  bloom.filter = 'blur(12px)'
  const sx = surface.width / Math.max(1, width)
  const sy = surface.height / Math.max(1, height)
  for (const glow of glows) {
    if (glow.radius < 1) continue
    const amount = Math.min(1, glow.amount + glow.punch * 0.65)
    const radius = glow.radius * (2.15 + amount * 0.85) * sx
    const alpha = Math.min(0.7, 0.28 + amount * 0.4)
    const x = glow.x * sx
    const y = glow.y * sy
    const halo = bloom.createRadialGradient(x, y, radius * 0.2, x, y, radius)
    halo.addColorStop(0, `rgba(255, 214, 180, ${alpha * 0.05})`)
    halo.addColorStop(0.42, `rgba(255, 78, 32, ${alpha * 0.7})`)
    halo.addColorStop(0.72, `rgba(168, 26, 12, ${alpha * 0.28})`)
    halo.addColorStop(1, 'rgba(90, 10, 4, 0)')
    bloom.fillStyle = halo
    bloom.beginPath()
    bloom.arc(x, y, radius, 0, Math.PI * 2)
    bloom.fill()
  }
  bloom.filter = 'none'
  context.save()
  context.globalCompositeOperation = 'screen'
  context.drawImage(surface, 0, 0, width, height)
  context.restore()
}

export function paintSplit(
  target: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  scratch: CanvasRenderingContext2D,
  fringe: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
  jitterX: number
): void {
  const scale = Math.max(1, width / 1400)
  const drift = Math.sin(now / 1700) * 0.55 + Math.sin(now / 4100) * 0.45
  const shift = (3.2 + drift * 2.4) * scale
  const lift = Math.sin(now / 2600) * shift * 0.28
  target.globalCompositeOperation = 'source-over'
  target.drawImage(source, jitterX, 0)
  fringe.globalCompositeOperation = 'source-over'
  fringe.clearRect(0, 0, width, height)
  layChannel(fringe, source, scratch, width, height, -shift + jitterX, lift, '#ff0000')
  layChannel(fringe, source, scratch, width, height, shift + jitterX, -lift, '#0000ff')
  const span = Math.min(width, height)
  fringe.save()
  fringe.globalCompositeOperation = 'destination-in'
  const mask = fringe.createRadialGradient(width * 0.5, height * 0.48, span * 0.08, width * 0.5, height * 0.5, span * 0.68)
  mask.addColorStop(0, 'rgba(0, 0, 0, 0.22)')
  mask.addColorStop(0.45, 'rgba(0, 0, 0, 0.4)')
  mask.addColorStop(1, 'rgba(0, 0, 0, 1)')
  fringe.fillStyle = mask
  fringe.fillRect(0, 0, width, height)
  fringe.restore()
  target.save()
  target.globalCompositeOperation = 'screen'
  target.drawImage(fringe.canvas, 0, 0)
  target.restore()
  target.globalCompositeOperation = 'source-over'
}

const DYING_SPANS: readonly [number, boolean][] = [
  [920, true],
  [80, false],
  [46, true],
  [150, false],
  [1080, true],
  [36, false],
  [28, true],
  [280, false],
  [520, true],
  [210, false],
  [64, true],
  [440, false],
  [740, true],
  [120, false]
]

const DYING_CYCLE = DYING_SPANS.reduce((sum, [span]) => sum + span, 0)

/** Split's red and blue copies. Longer dark gaps, shorter flashes. */
const SPLIT_SPANS: readonly [number, boolean][] = [
  [860, false],
  [340, true],
  [70, false],
  [36, true],
  [620, false],
  [480, true],
  [1200, false],
  [90, true],
  [50, false],
  [28, true],
  [740, false],
  [520, true],
  [400, false],
  [160, true]
]

const SPLIT_CYCLE = SPLIT_SPANS.reduce((sum, [span]) => sum + span, 0)

/** Quiet stretches for one ghost. Each ghost sits somewhere else in this cycle. */
const SPLIT_WINDOW: readonly [number, boolean][] = [
  [1400, false],
  [1100, true],
  [1800, false],
  [800, true],
  [2000, false],
  [1300, true]
]

const SPLIT_WINDOW_CYCLE = SPLIT_WINDOW.reduce((sum, [span]) => sum + span, 0)

function pulsed(spans: readonly [number, boolean][], cycle: number, offset: number, now: number): boolean {
  return pulseMark(spans, cycle, offset, now) >= 0
}

/** The current lit span, or -1 while this pulse is dark. Stable until the span ends. */
function pulseMark(spans: readonly [number, boolean][], cycle: number, offset: number, now: number): number {
  const phase = ((now + offset) % cycle + cycle) % cycle
  const turn = Math.floor((now + offset) / cycle)
  let at = 0
  for (let index = 0; index < spans.length; index += 1) {
    const [span, on] = spans[index]!
    if (phase < at + span) return on ? turn * spans.length + index : -1
    at += span
  }
  return -1
}

/** A stable scramble so neighboring circles do not share the same lull. */
function ghostOffset(seed: number, cycle: number): number {
  return (Math.imul(seed + 17, 0x9e3779b1) >>> 0) % cycle
}

/**
 * A light trying to stay on. Long holds, then uneven dropouts and a short spark.
 * `seed` shifts each circle so they fail on their own.
 */
export function dyingLight(seed: number, now: number): boolean {
  return pulsed(DYING_SPANS, DYING_CYCLE, seed * 311, now)
}

/** Whether one Split ghost is lit. Quiet for long stretches, then a short failing flash. */
export function splitGhost(seed: number, now: number): boolean {
  if (!pulsed(SPLIT_WINDOW, SPLIT_WINDOW_CYCLE, ghostOffset(seed, SPLIT_WINDOW_CYCLE), now)) return false
  return pulsed(SPLIT_SPANS, SPLIT_CYCLE, ghostOffset(seed + 100, SPLIT_CYCLE), now)
}

/** About one flash in fifty is black, and it stays black until that flash ends. */
export function splitFlashBlack(seed: number, now: number): boolean {
  const windowId = pulseMark(SPLIT_WINDOW, SPLIT_WINDOW_CYCLE, ghostOffset(seed, SPLIT_WINDOW_CYCLE), now)
  const spanId = pulseMark(SPLIT_SPANS, SPLIT_CYCLE, ghostOffset(seed + 100, SPLIT_CYCLE), now)
  if (windowId < 0 || spanId < 0) return false
  const mixed = Math.imul(windowId + seed * 13 + 1, 0x85ebca6b) ^ Math.imul(spanId + 1, 0xc2b2ae35)
  const roll = Math.imul(mixed ^ (mixed >>> 16), 0x27d4eb2f) >>> 0
  return roll % 50 === 0
}
export function paintFlatSplit(
  context: CanvasRenderingContext2D,
  glows: readonly Highlight[],
  width: number,
  now: number
): void {
  context.save()
  context.globalCompositeOperation = 'source-over'
  glows.forEach((glow, index) => {
    if (glow.radius < 1) return
    const shift = Math.max(5, glow.radius * 0.22) * Math.min(1.2, Math.max(0.85, width / 1600)) * 0.95
    if (splitGhost(index + 1, now)) {
      context.fillStyle = splitFlashBlack(index + 1, now) ? '#141414' : '#c42727'
      context.beginPath()
      context.arc(glow.x - shift, glow.y, glow.radius, 0, Math.PI * 2)
      context.fill()
    }
    if (splitGhost(index + 41, now)) {
      context.fillStyle = splitFlashBlack(index + 41, now) ? '#141414' : '#1b5dac'
      context.beginPath()
      context.arc(glow.x + shift, glow.y, glow.radius, 0, Math.PI * 2)
      context.fill()
    }
    const [red, green, blue] = glow.color
    context.fillStyle = `rgb(${red}, ${green}, ${blue})`
    context.beginPath()
    context.arc(glow.x, glow.y, glow.radius, 0, Math.PI * 2)
    context.fill()
  })
  context.restore()
}

export function paintBleed(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  scratch: CanvasRenderingContext2D,
  width: number,
  height: number,
  extra: number
): void {
  const shift = Math.max(4, width * 0.0034) + extra
  fringeChannel(context, source, scratch, width, height, shift, 0, '#ff6430', 0.5)
  fringeChannel(context, source, scratch, width, height, -shift * 0.85, 0, '#3a6cff', 0.32)
}

export function paintTapeMarks(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
  tape: TapeLook,
  flat = false
): void {
  const y = ((now / 14) % (height + 30)) - 12
  const y2 = height - ((now / 22) % (height + 40))
  if (flat) {
    context.save()
    context.globalAlpha = 1
    context.fillStyle = '#141414'
    context.fillRect(0, y, width, Math.max(3, height * 0.005))
    context.fillRect(0, y2, width, Math.max(2, height * 0.003))
    if (now < tape.dropUntil) {
      const top = tape.dropY * height
      const band = Math.max(6, tape.dropH * height)
      context.fillStyle = '#8a8a8a'
      context.fillRect(0, top, width, band)
    }
    context.restore()
    return
  }
  context.save()
  context.globalAlpha = 0.42
  context.fillStyle = 'rgba(255, 228, 196, 0.95)'
  context.fillRect(0, y, width, Math.max(2, height * 0.0024))
  context.fillStyle = 'rgba(0, 0, 0, 0.85)'
  context.fillRect(0, y + Math.max(3, height * 0.004), width, Math.max(2, height * 0.0016))
  context.globalAlpha = 0.22
  context.fillStyle = 'rgba(255, 210, 170, 0.8)'
  context.fillRect(0, y2, width, Math.max(1, height * 0.0014))
  context.restore()
  if (now < tape.tearUntil) {
    context.save()
    context.globalAlpha = 0.22
    context.fillStyle = 'rgba(255, 236, 210, 0.8)'
    context.fillRect(0, tape.tearY * height, width, Math.max(2, tape.tearH * height))
    context.restore()
  }
  if (now < tape.dropUntil) {
    const top = tape.dropY * height
    const band = Math.max(6, tape.dropH * height)
    context.save()
    context.globalCompositeOperation = 'multiply'
    context.fillStyle = 'rgba(28, 20, 16, 0.72)'
    context.fillRect(0, top, width, band)
    context.restore()
    context.save()
    context.globalAlpha = 0.35
    context.fillStyle = 'rgba(210, 196, 170, 0.35)'
    const flecks = 14
    let state = Math.floor(top * 13 + now) >>> 0
    for (let i = 0; i < flecks; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const fx = (state % 1000) / 1000 * width
      const fy = top + ((state >>> 10) % 1000) / 1000 * band
      context.fillRect(fx, fy, 2 + (state % 18), 1)
    }
    context.restore()
  }
}

/** The full tape treatment, drawn onto its own canvas so it can fade in over the picture. */
export function paintTapeFrame(
  target: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  scratch: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
  tape: TapeLook,
  flat = false
): void {
  const jitter = now < tape.jitterUntil ? tape.jitterX : 0
  target.globalCompositeOperation = 'source-over'
  target.globalAlpha = 1
  target.fillStyle = flat ? '#cccccc' : '#100c0a'
  target.fillRect(0, 0, width, height)
  target.drawImage(source, jitter, 0)
  if (now < tape.tearUntil) {
    const tearY = tape.tearY * height
    const tearH = Math.max(3, tape.tearH * height)
    target.drawImage(source, 0, tearY, width, tearH, jitter + tape.tearX, tearY, width, tearH)
  }
  if (!flat) {
    const extra = now < tape.jitterUntil ? 5 : 0
    paintBleed(target, source, scratch, width, height, extra)
  }
  paintTapeMarks(target, width, height, now, tape, flat)
}

/**
 * How open the Sweep vignette is, from 0 (pulled in) to 1 (eased out).
 * Slow swells, a wandering twitch, and a small flutter keep it from looping.
 */
export function vignetteOpening(now: number): number {
  const t = now / 1000
  const swell = Math.sin(t * 0.47) * 0.4 + Math.sin(t * 1.09 + 2.2) * 0.34 + Math.sin(t * 0.23 + 0.7) * 0.26
  const cadence = 1.35 + Math.sin(t * 0.17) * 0.45
  const phase = t * cadence
  const tick = Math.floor(phase)
  const fade = phase - tick
  const ease = fade * fade * (3 - 2 * fade)
  const from = signedHash(tick)
  const twitch = from + (signedHash(tick + 1) - from) * ease
  const flutter = Math.sin(t * 5.1 + signedHash(Math.floor(t * 1.3)) * 6) * 0.28
  const mixed = swell * 0.44 + twitch * 0.42 + flutter * 0.14
  return 0.5 + Math.max(-1, Math.min(1, mixed)) * 0.5
}

export function paintVignette(context: CanvasRenderingContext2D, width: number, height: number, now: number, flat = false): void {
  const t = now / 1000
  const open = vignetteOpening(now)
  const span = Math.min(width, height)
  if (flat) {
    const arm = span * (0.07 + open * 0.025)
    const weight = Math.max(3, span * 0.0045)
    const inset = span * (0.045 + (1 - open) * 0.035)
    const rule = Math.max(2, span * 0.0028)
    const travel = 0.5 + Math.sin(now / 1700) * 0.32
    const y = inset + Math.max(0, height - inset * 2) * travel
    context.save()
    context.fillStyle = '#141414'
    const marks: [number, number, number, number][] = [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [inset, height - inset, 1, -1],
      [width - inset, height - inset, -1, -1]
    ]
    for (const [x, yMark, hx, vy] of marks) {
      context.fillRect(hx > 0 ? x : x - arm, yMark - weight / 2, arm, weight)
      context.fillRect(x - weight / 2, vy > 0 ? yMark : yMark - arm, weight, arm)
    }
    context.fillRect(inset, y, Math.max(0, width - inset * 2), rule)
    context.restore()
    return
  }
  const cx = width * (0.5 + Math.sin(t / 5.8) * 0.03)
  const cy = height * (0.46 + Math.cos(t / 7.4) * 0.028)
  const inner = span * (0.08 + open * 0.18)
  const outer = span * (0.54 + open * 0.22)
  const edge = (0.38 + (1 - open) * 0.28).toFixed(3)
  const mid = 0.48 + (1 - open) * 0.14
  const shade = context.createRadialGradient(cx, cy, inner, cx, cy, outer)
  shade.addColorStop(0, 'rgba(0, 0, 0, 0)')
  shade.addColorStop(mid, 'rgba(20, 8, 4, 0.05)')
  shade.addColorStop(1, `rgba(6, 2, 0, ${edge})`)
  context.fillStyle = shade
  context.fillRect(0, 0, width, height)
}

export function paintDirt(
  context: CanvasRenderingContext2D,
  specks: readonly DirtSpeck[],
  width: number,
  height: number,
  now: number,
  catchLight: boolean,
  flat = false
): void {
  const t = now / 1000
  context.save()
  if (flat) {
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = '#141414'
    for (const speck of specks) {
      const x = speck.x * width
      const y = speck.y * height
      context.beginPath()
      if (speck.smear) {
        context.ellipse(x, y, speck.r * 1.4, speck.r * 0.45, speck.phase, 0, Math.PI * 2)
      } else {
        context.arc(x, y, Math.max(2.5, speck.r * 2.2), 0, Math.PI * 2)
      }
      context.fill()
    }
    context.restore()
    return
  }
  for (const speck of specks) {
    const x = speck.x * width
    const y = speck.y * height
    const twinkle = speck.smear ? 1 : 0.55 + 0.45 * Math.sin(t * 2.4 + speck.phase)
    if (speck.smear) {
      context.save()
      context.translate(x, y)
      context.rotate(speck.phase + t * 0.02)
      context.scale(1.8, 0.55)
      context.globalCompositeOperation = 'multiply'
      const smudge = context.createRadialGradient(0, 0, 0, 0, 0, speck.r)
      smudge.addColorStop(0, `rgba(42, 28, 20, ${speck.alpha})`)
      smudge.addColorStop(1, 'rgba(42, 28, 20, 0)')
      context.fillStyle = smudge
      context.beginPath()
      context.arc(0, 0, speck.r, 0, Math.PI * 2)
      context.fill()
      context.restore()
      if (catchLight) {
        context.save()
        context.globalCompositeOperation = 'screen'
        context.translate(x, y)
        const glint = context.createRadialGradient(0, 0, 0, 0, 0, speck.r * 0.8)
        glint.addColorStop(0, 'rgba(255, 176, 110, 0.16)')
        glint.addColorStop(1, 'rgba(255, 120, 60, 0)')
        context.fillStyle = glint
        context.beginPath()
        context.arc(0, 0, speck.r * 0.8, 0, Math.PI * 2)
        context.fill()
        context.restore()
      }
    } else {
      context.globalCompositeOperation = catchLight ? 'screen' : 'source-over'
      context.fillStyle = catchLight
        ? `rgba(255, 214, 170, ${Math.min(0.7, speck.alpha * 0.55 * twinkle)})`
        : `rgba(186, 164, 140, ${speck.alpha * 0.45 * twinkle})`
      context.beginPath()
      context.arc(x, y, speck.r, 0, Math.PI * 2)
      context.fill()
    }
  }
  context.restore()
}

export type LeakSpot = {
  x: number
  y: number
  radius: number
  alpha: number
  color: [number, number, number]
}

/** Amber and rose pools that cross the frame instead of sitting in one place. */
export function leakLayout(seconds: number): LeakSpot[] {
  const sway = (rate: number, phase = 0) => Math.sin(seconds * rate + phase)
  return [
    {
      x: 0.5 + sway(0.85) * 0.36 + sway(1.7, 0.6) * 0.08,
      y: 0.38 + sway(0.62, 1.1) * 0.3 + sway(1.35, 2) * 0.07,
      radius: 0.46 + sway(0.7, 0.4) * 0.07,
      alpha: 0.3 + sway(0.9) * 0.06,
      color: [255, 150, 54]
    },
    {
      x: 0.52 + sway(0.74, 2.2) * 0.38,
      y: 0.58 + sway(0.95, 0.3) * 0.28 + sway(1.6, 1.4) * 0.06,
      radius: 0.42 + sway(0.8, 1) * 0.06,
      alpha: 0.26 + sway(1.1, 0.8) * 0.05,
      color: [232, 92, 118]
    },
    {
      x: 0.46 + sway(1.15, 0.9) * 0.32 + sway(0.55, 2.4) * 0.1,
      y: 0.24 + sway(0.88, 1.7) * 0.22,
      radius: 0.36 + sway(1.05) * 0.06,
      alpha: 0.18 + sway(0.76, 0.5) * 0.05,
      color: [255, 196, 150]
    }
  ]
}

export function paintLeaks(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
  drive: number,
  flat = false
): void {
  const leaks = leakLayout(now / 1000)
  if (flat) {
    context.save()
    context.globalCompositeOperation = 'source-over'
    const span = Math.min(width, height)
    leaks.forEach((leak, index) => {
      if (!dyingLight(index * 23 + 11, now)) return
      context.fillStyle = `rgb(${leak.color[0]}, ${leak.color[1]}, ${leak.color[2]})`
      context.beginPath()
      context.arc(leak.x * width, leak.y * height, span * leak.radius * 0.34, 0, Math.PI * 2)
      context.fill()
    })
    context.restore()
    return
  }
  context.save()
  context.globalCompositeOperation = 'screen'
  const span = Math.min(width, height)
  for (const leak of leaks) {
    const x = leak.x * width
    const y = leak.y * height
    const radius = span * leak.radius
    const alpha = leak.alpha + Math.min(0.08, drive * 0.1)
    const glow = context.createRadialGradient(x, y, 0, x, y, radius)
    glow.addColorStop(0, `rgba(${leak.color[0]}, ${leak.color[1]}, ${leak.color[2]}, ${alpha})`)
    glow.addColorStop(0.38, `rgba(${leak.color[0]}, ${leak.color[1]}, ${leak.color[2]}, ${alpha * 0.55})`)
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = glow
    context.fillRect(0, 0, width, height)
  }
  context.restore()
}

function layChannel(
  dest: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  scratch: CanvasRenderingContext2D,
  width: number,
  height: number,
  dx: number,
  dy: number,
  color: string
): void {
  scratch.globalCompositeOperation = 'source-over'
  scratch.clearRect(0, 0, width, height)
  scratch.drawImage(source, 0, 0)
  scratch.globalCompositeOperation = 'multiply'
  scratch.fillStyle = color
  scratch.fillRect(0, 0, width, height)
  dest.save()
  dest.filter = 'brightness(2.6) contrast(1.4)'
  dest.globalCompositeOperation = 'lighter'
  dest.drawImage(scratch.canvas, dx, dy)
  dest.restore()
}

function fringeChannel(
  dest: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  scratch: CanvasRenderingContext2D,
  width: number,
  height: number,
  dx: number,
  dy: number,
  color: string,
  alpha: number
): void {
  scratch.globalCompositeOperation = 'source-over'
  scratch.clearRect(0, 0, width, height)
  scratch.drawImage(source, 0, 0)
  scratch.globalCompositeOperation = 'multiply'
  scratch.fillStyle = color
  scratch.fillRect(0, 0, width, height)
  dest.save()
  dest.globalCompositeOperation = 'screen'
  dest.globalAlpha = alpha
  dest.drawImage(scratch.canvas, dx, dy)
  dest.restore()
}

function signedHash(seed: number): number {
  return mulberry32(seed)() * 2 - 1
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
