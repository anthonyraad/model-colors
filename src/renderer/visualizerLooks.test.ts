import { describe, expect, it } from 'vitest'
import { stutterGate } from '../audio/stutter'
import { createDirt, createTapeLook, dyingLight, flatGrainCoat, flatGrainDensity, grainAlpha, grainFlicker, highFrequency, leakLayout, lookFade, splitFlashBlack, splitGhost, stepDirt, stepLook, stepTape, stutterPresence, vignetteOpening } from './visualizerLooks'

describe('visualizer looks', () => {
  it('thickens the grain as the high end gets louder', () => {
    expect(highFrequency([0, 0, 0, 0, 0, 0])).toBe(0)
    expect(highFrequency([1, 1, 1, 1, 0, 0])).toBe(0)
    expect(highFrequency([0, 0, 0, 0, 0, 1])).toBeCloseTo(0.65)
    expect(grainAlpha(1)).toBeGreaterThan(grainAlpha(0))
    expect(grainAlpha(0)).toBeGreaterThan(0.15)
    expect(grainAlpha(1)).toBeLessThan(0.8)
    const flicker = Array.from({ length: 48 }, (_, index) => grainFlicker(index * 97 + 3))
    expect(Math.max(...flicker) - Math.min(...flicker)).toBeGreaterThan(0.45)
    expect(Math.min(...flicker)).toBeGreaterThan(0.4)
    expect(Math.max(...flicker)).toBeLessThan(1.25)
    expect(flatGrainDensity(0, 0)).toBeLessThan(flatGrainDensity(1, 0))
    expect(flatGrainDensity(0, 1)).toBeGreaterThan(flatGrainDensity(0, 0))
    expect(flatGrainDensity(1, 1)).toBeLessThan(0.25)
    const coats = Array.from({ length: 200 }, (_, index) => flatGrainCoat(index * 17 + 3))
    expect(Math.min(...coats)).toBeLessThan(0.3)
    expect(Math.max(...coats)).toBeGreaterThan(0.7)
    expect(lookFade(0, 120, 0)).toBe(1)
    expect(lookFade(1, 120, 0)).toBe(0)
    expect(lookFade(1, 120, 1000)).toBeCloseTo(0.5)
    expect(lookFade(1, 120, 2000)).toBe(1)
    expect(lookFade(2, 120, 2000)).toBeCloseTo(0.5)
    expect(lookFade(4, 120, 4000)).toBeCloseTo(0.5)
    expect(lookFade(4, 0, 8000)).toBe(1)
  })

  it('fades a look back out from wherever it was', () => {
    const ramp = { on: false, at: 0, bars: 0, bpm: 120, from: 0 }
    expect(stepLook(ramp, true, 0, 120, 0)).toBe(1)
    const rising = { on: false, at: 0, bars: 0, bpm: 120, from: 0 }
    expect(stepLook(rising, true, 2, 120, 1_000)).toBe(0)
    expect(stepLook(rising, true, 2, 120, 3_000)).toBeCloseTo(0.5)
    expect(stepLook(rising, false, 2, 120, 3_000)).toBeCloseTo(0.5)
    expect(stepLook(rising, false, 2, 120, 5_000)).toBeCloseTo(0.25)
    expect(stepLook(rising, false, 2, 120, 7_000)).toBe(0)
    const held = { on: true, at: 0, bars: 0, bpm: 120, from: 0 }
    expect(stepLook(held, false, 0, 120, 4_000)).toBe(0)
  })

  it('lets a dying light hold, drop out, and spark back', () => {
    const samples = Array.from({ length: 240 }, (_, index) => dyingLight(3, index * 20))
    const on = samples.filter(Boolean).length
    expect(on).toBeGreaterThan(samples.length * 0.55)
    expect(on).toBeLessThan(samples.length)
    const other = Array.from({ length: 80 }, (_, index) => dyingLight(9, index * 50))
    const first = Array.from({ length: 80 }, (_, index) => dyingLight(1, index * 50))
    expect(first.some((lit, index) => lit !== other[index])).toBe(true)
    const ghosts = Array.from({ length: 1000 }, (_, index) => splitGhost(3, index * 20))
    const ghostOn = ghosts.filter(Boolean).length
    const lights = Array.from({ length: 1000 }, (_, index) => dyingLight(3, index * 20))
    expect(ghostOn).toBeGreaterThan(0)
    expect(ghostOn).toBeLessThan(ghosts.length * 0.22)
    expect(ghostOn).toBeLessThan(lights.filter(Boolean).length)
    const seeds = [1, 2, 3, 4, 5, 6, 42, 43, 44, 45, 46, 47]
    const times = Array.from({ length: 400 }, (_, index) => index * 50)
    let darkRun = 0
    let longestDark = 0
    for (const now of times) {
      if (seeds.some((seed) => splitGhost(seed, now))) {
        longestDark = Math.max(longestDark, darkRun)
        darkRun = 0
      } else darkRun += 1
    }
    longestDark = Math.max(longestDark, darkRun)
    expect(longestDark).toBeLessThan(16)
    const firstOn = seeds.map((seed) => times.findIndex((now) => splitGhost(seed, now)))
    expect(new Set(firstOn).size).toBeGreaterThan(4)
  })

  it('turns about one split flash in fifty black and keeps it black', () => {
    let flashes = 0
    let black = 0
    for (let seed = 1; seed <= 80; seed += 1) {
      let wasOn = false
      let ink = false
      for (let now = 0; now < 90000; now += 20) {
        const on = splitGhost(seed, now)
        if (on && !wasOn) {
          flashes += 1
          ink = splitFlashBlack(seed, now)
          if (ink) black += 1
        }
        if (on) expect(splitFlashBlack(seed, now)).toBe(ink)
        wasOn = on
      }
    }
    expect(flashes).toBeGreaterThan(200)
    expect(black / flashes).toBeGreaterThan(0.008)
    expect(black / flashes).toBeLessThan(0.04)
  })

  it('blinks a light-mode circle with the stutter and keeps the dark size pulse', () => {
    expect(stutterPresence(1, true)).toEqual({ scale: 1, shown: true })
    expect(stutterPresence(0.4, true)).toEqual({ scale: 1, shown: false })
    expect(stutterPresence(0, false)).toEqual({ scale: 0.22, shown: true })
    expect(stutterPresence(1, false).scale).toBeCloseTo(1)
    const gates = [0, 0.25, 0.5, 0.75, 1].map((at) => stutterGate(at, 1, 120))
    const shown = gates.map((gate) => stutterPresence(gate, true).shown)
    expect(shown.some(Boolean)).toBe(true)
    expect(shown.some((on) => !on)).toBe(true)
  })

  it('saves tape damage for a loud hit and then waits', () => {
    const quiet = stepTape(createTapeLook(), 1_000, 0.2, 0.1, 900)
    expect(quiet.jitterUntil).toBe(0)
    expect(quiet.dropUntil).toBe(0)
    const hit = stepTape(createTapeLook(), 1_000, 0.8, 0.7, 900)
    expect(hit.jitterUntil).toBeGreaterThan(1_000)
    expect(hit.tearUntil).toBeGreaterThan(1_000)
    expect(hit.dropUntil).toBeGreaterThan(1_000)
    const again = stepTape(hit, 1_200, 0.9, 0.1, 900)
    expect(again).toBe(hit)
  })

  it('wanders the dust and carries the light leaks across the frame', () => {
    const specks = createDirt(8)
    const start = specks.map((speck) => ({ x: speck.x, y: speck.y }))
    for (let frame = 0; frame < 30; frame += 1) stepDirt(specks, 1_000 + frame * 50, 0.05, () => 0.2)
    const travel = specks.reduce((sum, speck, index) => {
      const from = start[index]
      return sum + Math.hypot(speck.x - (from?.x ?? 0), speck.y - (from?.y ?? 0))
    }, 0)
    expect(travel).toBeGreaterThan(0.25)
    const early = leakLayout(0)[0]
    const later = leakLayout(4)[0]
    expect(Math.hypot((later?.x ?? 0) - (early?.x ?? 0), (later?.y ?? 0) - (early?.y ?? 0))).toBeGreaterThan(0.15)
  })

  it('lets the sweep vignette wander in and out without jumping', () => {
    const samples = Array.from({ length: 200 }, (_, index) => vignetteOpening(index * 80))
    const later = Array.from({ length: 200 }, (_, index) => vignetteOpening(18_000 + index * 80))
    const span = Math.max(...samples) - Math.min(...samples)
    const steps = samples.slice(1).map((value, index) => Math.abs(value - (samples[index] ?? 0)))
    const drift = samples.reduce((sum, value, index) => sum + Math.abs(value - (later[index] ?? 0)), 0) / samples.length
    expect(span).toBeGreaterThan(0.35)
    expect(Math.min(...samples)).toBeGreaterThan(0)
    expect(Math.max(...samples)).toBeLessThan(1)
    expect(Math.max(...steps)).toBeLessThan(0.16)
    expect(drift).toBeGreaterThan(0.04)
  })
})