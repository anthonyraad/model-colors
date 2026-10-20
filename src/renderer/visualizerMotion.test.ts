import { describe, expect, it } from 'vitest'
import {
  assignColors,
  audibleAmount,
  bandLevels,
  bandOnset,
  createColorHistory,
  createGroovePrint,
  createOrbs,
  createSequencerGrid,
  easeBreath,
  hearClock,
  hearNote,
  hearTransport,
  historyCurrent,
  noticePatternChange,
  paletteForProgram,
  patternShuffle,
  redoColors,
  clusterHome,
  orbPress,
  stepOrb,
  trackForNote,
  trackLevels,
  undoColors,
  waveformPoints,
  waveformRms
} from './visualizerMotion'

describe('visualizer motion', () => {
  it('holds each track nearly still and at a steady size when there is no sound', () => {
    const orbs = createOrbs()
    const span = 1000
    const homes = orbs.map((_, index) => clusterHome(index, 1400, span, 0, 0))
    orbs.forEach((orb, index) => stepOrb(orb, index, 1 / 60, homes[index], 0, 0, 0, span, 0))
    const start = orbs.map((orb) => ({ x: orb.x, y: orb.y }))
    const restRadius = orbs.map((orb, index) => stepOrb(orb, index, 1 / 60, homes[index], 0, 0, 0, span, 16))
    for (let frame = 0; frame < 120; frame += 1) {
      orbs.forEach((orb, index) => stepOrb(orb, index, 1 / 60, homes[index], 0, 0, 0, span, frame * 16))
    }
    orbs.forEach((orb, index) => {
      const moved = Math.hypot(orb.x - start[index].x, orb.y - start[index].y)
      expect(moved).toBeLessThan(span * 0.025)
      const radius = stepOrb(orb, index, 1 / 60, homes[index], 0, 0, 0, span, 3000)
      expect(Math.abs(radius - restRadius[index])).toBeLessThan(span * 0.01)
    })
  })

  it('seats the kick low, metal high, and the tonal tracks between them', () => {
    const width = 1600
    const height = 1000
    const start = Array.from({ length: 6 }, (_, index) => clusterHome(index, width, height, 0, 1))
    const later = Array.from({ length: 6 }, (_, index) => clusterHome(index, width, height, 2000, 1))
    const kick = start[0]
    const metal = start[2]
    const tone = start[4]
    const chord = start[5]
    expect(kick.y).toBeGreaterThan(tone.y)
    expect(kick.y).toBeGreaterThan(chord.y)
    expect(metal.y).toBeLessThan(tone.y)
    expect(metal.y).toBeLessThan(chord.y)
    const span = Math.min(width, height)
    expect(Math.max(...start.map((point) => point.x)) - Math.min(...start.map((point) => point.x))).toBeGreaterThan(span * 0.28)
    start.forEach((point, index) => {
      expect(point.x).toBeGreaterThan(span * 0.16)
      expect(point.x).toBeLessThan(width - span * 0.16)
      expect(point.y).toBeGreaterThan(span * 0.12)
      expect(point.y).toBeLessThan(height - span * 0.12)
      const moved = Math.hypot(later[index].x - point.x, later[index].y - point.y)
      const shoved = Math.hypot(point.x - clusterHome(index, width, height, 0, 0).x, point.y - clusterHome(index, width, height, 0, 0).y)
      expect(moved).toBeLessThan(1)
      expect(shoved).toBeLessThan(1)
    })
  })

  it('bounces a hit inside the picture', () => {
    const orbs = createOrbs()
    const span = 1000
    const homes = orbs.map((_, index) => clusterHome(index, 1400, span, 0, 0))
    orbs.forEach((orb, index) => stepOrb(orb, index, 1 / 60, homes[index], 0.8, 0, 0, span, 0, 1400, 1000))
    const start = orbs.map((orb) => ({ x: orb.x, y: orb.y }))
    let loud = 0
    for (let frame = 0; frame < 18; frame += 1) {
      orbs.forEach((orb, index) => {
        const radius = stepOrb(
          orb,
          index,
          1 / 60,
          homes[index],
          0.9,
          index === 0 ? 0.85 : 0.05,
          frame === 0 && index === 0 ? 1 : 0,
          span,
          frame * 16,
          1400,
          1000
        )
        if (index === 0) loud = radius
      })
    }
    const kicked = Math.hypot(orbs[0].x - start[0].x, orbs[0].y - start[0].y)
    const other = Math.hypot(orbs[3].x - start[3].x, orbs[3].y - start[3].y)
    expect(kicked).toBeGreaterThan(other)
    expect(kicked).toBeGreaterThan(span * 0.015)
    orbs.forEach((orb) => {
      expect(orb.x).toBeGreaterThan(span * 0.16)
      expect(orb.x).toBeLessThan(1400 - span * 0.16)
      expect(orb.y).toBeGreaterThan(span * 0.16)
      expect(orb.y).toBeLessThan(span - span * 0.16)
    })
    expect(loud).toBeGreaterThan(span * 0.25)
    const ember = stepOrb(orbs[3], 3, 1 / 60, homes[3], 1, 0, 0, span, 400, 1400, 1000)
    expect(ember).toBeLessThan(span * 0.08)
    expect(loud).toBeGreaterThan(ember * 2)
  })

  it('keeps a quiet track an ember while another track is hit', () => {
    const freq = new Uint8Array(1024)
    freq[3] = 255
    const low = trackLevels(bandLevels(freq, 48000))
    expect(low[0]).toBeGreaterThan(0.4)
    expect(low[2]).toBe(0)
    freq[3] = 0
    freq[400] = 255
    const high = trackLevels(bandLevels(freq, 48000))
    expect(high[2]).toBeGreaterThan(0.4)
    expect(high[0]).toBe(0)
    const splash = trackLevels([0.9, 0.06, 0.04, 0.05, 0.07, 0.08])
    expect(splash[0]).toBeGreaterThan(0.5)
    expect(Math.max(splash[1] ?? 0, splash[2] ?? 0, splash[3] ?? 0, splash[4] ?? 0, splash[5] ?? 0)).toBeLessThan(0.05)
    const kit = trackLevels([0.8, 0.42, 0.36, 0.3, 0.34, 0.7])
    expect(kit[0]).toBeGreaterThan(0.7)
    expect(kit[1]).toBeGreaterThan(0.4)
    expect(kit[3]).toBe(0)
    expect(kit[4]).toBe(0)
  })

  it('stretches a quiet waveform and leaves silence flat', () => {
    const silent = waveformPoints(new Uint8Array(32).fill(128))
    expect(silent.every((sample) => sample === 0)).toBe(true)
    const quiet = new Uint8Array(32).fill(128)
    quiet[4] = 136
    quiet[12] = 120
    const shaped = waveformPoints(quiet)
    const peak = Math.max(...shaped.map((sample) => Math.abs(sample)))
    expect(peak).toBeGreaterThan(0.04)
    expect(peak).toBeLessThan(0.2)
  })

  it('splits a low hit and a high hit across different tracks', () => {
    const freq = new Uint8Array(1024)
    freq[3] = 255
    freq[400] = 255
    const bands = bandLevels(freq, 48000)
    expect(bands[0]).toBeGreaterThan(0.4)
    expect(bands[5]).toBeGreaterThan(0.4)
    expect(bands[2]).toBeLessThan(0.05)
    expect(bandOnset(0.05, 0.5)).toBeGreaterThan(0.5)
    expect(bandOnset(0.4, 0.42)).toBe(0)
  })

  it('treats a quiet input as silence and a loud one as sound', () => {
    expect(audibleAmount(0, 0)).toBe(0)
    expect(audibleAmount(0.006, 0.02)).toBe(0)
    expect(audibleAmount(0.2, 0)).toBeGreaterThan(0.7)
    expect(waveformRms(new Uint8Array(64).fill(128))).toBe(0)
  })

  it('maps an incoming note to the track on that channel', () => {
    expect(trackForNote(1, [1, 2, 3, 4, 5, 6])).toBe(0)
    expect(trackForNote(6, [1, 2, 3, 4, 5, 6])).toBe(5)
    expect(trackForNote(10, [1, 2, 3, 4, 5, 6])).toBe(-1)
  })

  it('keeps a color history for the arrow keys and a stable palette per pattern', () => {
    const history = createColorHistory()
    const first = historyCurrent(history).map((color) => [...color])
    redoColors(history, paletteForProgram(1))
    redoColors(history, paletteForProgram(2))
    expect(historyCurrent(history)[0]).not.toEqual(paletteForProgram(1)[0])
    expect(undoColors(history)).toBe(true)
    expect(historyCurrent(history)).toEqual(paletteForProgram(1))
    expect(undoColors(history)).toBe(true)
    expect(historyCurrent(history)).toEqual(first)
    expect(undoColors(history)).toBe(false)
    expect(paletteForProgram(0)).not.toEqual(paletteForProgram(1))

    const orbs = createOrbs()
    assignColors(orbs, paletteForProgram(4))
    for (let frame = 0; frame < 45; frame += 1) {
      stepOrb(orbs[0], 0, 1 / 30, clusterHome(0, 800, 600, 0, 0), 0, 0, 0, 600, frame * 33)
    }
    expect(Math.abs(orbs[0].color[0] - orbs[0].target[0])).toBeLessThan(8)
    expect(patternShuffle(4, null, 1000)).toBe(true)
    expect(patternShuffle(4, { program: 4, at: 800 }, 1000)).toBe(false)
    expect(patternShuffle(5, { program: 4, at: 990 }, 1000)).toBe(true)
  })

  it('hears a new pattern in the mix and ignores a steady loop', () => {
    const print = createGroovePrint()
    const loop = [0.8, 0.15, 0.1, 0.25, 0.7, 0.2]
    let fired = 0
    for (let frame = 0; frame < 240; frame += 1) {
      if (noticePatternChange(print, loop, 0.6, 1 / 60)) fired += 1
    }
    expect(fired).toBe(0)
    const next = [0.05, 0.08, 0.15, 0.2, 0.25, 0.9]
    for (let frame = 0; frame < 150; frame += 1) {
      if (noticePatternChange(print, next, 0.7, 1 / 60)) fired += 1
    }
    expect(fired).toBe(1)
    for (let frame = 0; frame < 60; frame += 1) noticePatternChange(print, [0, 0, 0, 0, 0, 0], 0, 1 / 60)
  })

  it('ignores drum hits inside one pattern and hears a different rhythm', () => {
    const pulse = (gates: number[], frame: number): number[] => {
      const step = Math.floor(frame / 5) % gates.length
      const on = gates[step] ?? 0
      const level = 0.1 + on * 0.8
      return [level * 0.85, level * 0.2, level * 0.12, level * 0.22, level * 0.5, level * 0.3]
    }
    const fours = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    const syncopation = [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0]
    const print = createGroovePrint()
    let fired = 0
    for (let frame = 0; frame < 400; frame += 1) {
      if (noticePatternChange(print, pulse(fours, frame), 0.7, 1 / 60)) fired += 1
    }
    expect(fired).toBe(0)
    for (let frame = 0; frame < 220; frame += 1) {
      if (noticePatternChange(print, pulse(syncopation, frame), 0.7, 1 / 60)) fired += 1
    }
    expect(fired).toBe(1)
  })

  it('still hears a new pattern when the hits are separated by silence', () => {
    const pulse = (gates: number[], frame: number): { bands: number[]; drive: number } => {
      const step = Math.floor(frame / 5) % gates.length
      const on = gates[step] ?? 0
      const level = on > 0 ? 0.15 + on * 0.8 : 0.01
      return {
        bands: [level * 0.85, level * 0.2, level * 0.12, level * 0.22, level * 0.5, level * 0.3],
        drive: on > 0 ? 0.7 : 0.02
      }
    }
    const fours = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    const syncopation = [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0]
    const print = createGroovePrint()
    let fired = 0
    for (let frame = 0; frame < 420; frame += 1) {
      const sample = pulse(fours, frame)
      if (noticePatternChange(print, sample.bands, sample.drive, 1 / 60)) fired += 1
    }
    expect(fired).toBe(0)
    for (let frame = 0; frame < 240; frame += 1) {
      const sample = pulse(syncopation, frame)
      if (noticePatternChange(print, sample.bands, sample.drive, 1 / 60)) fired += 1
    }
    expect(fired).toBe(1)
  })

  it('hears hats move to different steps while the kick stays', () => {
    const pulse = (gates: number[], frame: number): number[] => {
      const step = Math.floor(frame / 5) % gates.length
      const level = 0.08 + (gates[step] ?? 0) * 0.85
      return [level * 0.8, level * 0.25, level * 0.12, level * 0.2, level * 0.55, level * 0.3]
    }
    const hats = [1, 0, 0.45, 0, 1, 0, 0.45, 0, 1, 0, 0.45, 0, 1, 0, 0.45, 0]
    const moved = [1, 0, 0, 0.5, 1, 0.35, 0, 0, 1, 0, 0.55, 0, 1, 0, 0, 0.4]
    const print = createGroovePrint()
    let fired = 0
    for (let frame = 0; frame < 420; frame += 1) {
      if (noticePatternChange(print, pulse(hats, frame), 0.65, 1 / 60)) fired += 1
    }
    expect(fired).toBe(0)
    for (let frame = 0; frame < 240; frame += 1) {
      if (noticePatternChange(print, pulse(moved, frame), 0.65, 1 / 60)) fired += 1
    }
    expect(fired).toBe(1)
  })

  it('hears a pattern change from the sequencer clock when the mix stays the same', () => {
    const pulse = (gates: number[], step: number): number[] => {
      const on = gates[step % gates.length] ?? 0
      const level = 0.08 + on * 0.85
      return [level * 0.7, level * 0.15, level * 0.1, level * 0.2, level * 0.45, level * 0.25]
    }
    const fours = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    const offbeat = [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]
    const print = createGroovePrint()
    let fired = 0
    const play = (gates: number[], bars: number) => {
      for (let bar = 0; bar < bars; bar += 1) {
        for (let step = 0; step < 16; step += 1) {
          for (let tick = 0; tick < 6; tick += 1) hearClock(print)
          for (let frame = 0; frame < 4; frame += 1) {
            if (noticePatternChange(print, pulse(gates, step), 0.7, 1 / 60)) fired += 1
          }
        }
      }
    }
    play(fours, 6)
    expect(fired).toBe(0)
    play(offbeat, 3)
    expect(fired).toBe(1)
  })

  it('hears a smoothed kit change and ignores the same loop with decay and noise', () => {
    const state = { smooth: [0, 0, 0, 0, 0, 0] }
    const kit = (gates: number[], frame: number): { bands: number[]; drive: number } => {
      const stepDur = 8
      const step = Math.floor(frame / stepDur) % 16
      const sub = frame % stepDur
      let env = 0.01
      for (let back = 0; back < 6; back += 1) {
        const gate = gates[(step - back + 16) % 16] ?? 0
        env += gate * Math.exp(-(back * stepDur + sub) / 5.5)
      }
      const weights = [1, 0.42, 0.18, 0.22, 0.62, 0.36]
      const raw = weights.map((weight, index) => {
        const wobble = 1 + ((((frame + 1) * (index + 3)) % 5) - 2) * 0.04
        return Math.max(0, env * weight * wobble)
      })
      state.smooth = state.smooth.map((value, index) => value * 0.7 + (raw[index] ?? 0) * 0.3)
      const level = Math.max(...state.smooth)
      return { bands: state.smooth, drive: level > 0.08 ? 0.62 : 0.03 }
    }
    const loop = [1, 0, 0.35, 0, 1, 0, 0.35, 0, 1, 0, 0.35, 0, 1, 0, 0.35, 0]
    const next = [1, 0, 0, 0.6, 0.25, 0.8, 0, 0.2, 1, 0.45, 0, 0, 0.7, 0, 0.55, 0.3]
    const print = createGroovePrint()
    let fired = 0
    for (let frame = 0; frame < 520; frame += 1) {
      const sample = kit(loop, frame)
      if (noticePatternChange(print, sample.bands, sample.drive, 1 / 60)) fired += 1
    }
    expect(fired).toBe(0)
    for (let frame = 0; frame < 360; frame += 1) {
      const sample = kit(next, frame + 520)
      if (noticePatternChange(print, sample.bands, sample.drive, 1 / 60)) fired += 1
    }
    expect(fired).toBe(1)
  })

  it('hears a new pattern from the notes the sequencer plays', () => {
    const print = createGroovePrint()
    const bands = [0.22, 0.12, 0.08, 0.1, 0.16, 0.09]
    let fired = 0
    for (let frame = 0; frame < 240; frame += 1) {
      if (frame % 6 === 0) hearNote(print, frame % 12 === 0 ? 36 : 38)
      if (noticePatternChange(print, bands, 0.5, 1 / 60)) fired += 1
    }
    expect(fired).toBe(0)
    for (let frame = 0; frame < 240; frame += 1) {
      if (frame % 6 === 0) hearNote(print, 55 + (frame % 5))
      if (noticePatternChange(print, bands, 0.5, 1 / 60)) fired += 1
    }
    expect(fired).toBe(1)
  })

  it('breathes on the downbeat and leaves the other steps alone', () => {
    const grid = createSequencerGrid()
    expect(hearTransport(grid, 'start')).toBe(true)
    expect(grid.breath).toBe(1)
    let downs = 0
    for (let clock = 0; clock < 95; clock += 1) if (hearTransport(grid, 'clock')) downs += 1
    expect(downs).toBe(0)
    expect(hearTransport(grid, 'clock')).toBe(true)
    easeBreath(grid, 0.8)
    expect(grid.breath).toBeLessThan(0.4)
    expect(grid.breath).toBeGreaterThan(0.05)
    hearTransport(grid, 'stop')
    expect(hearTransport(grid, 'clock')).toBe(false)
  })

  it('swells every circle on the breath and hops only the circle that sounded', () => {
    const orbs = createOrbs()
    const span = 1000
    const home = clusterHome(0, 1400, span, 0, 0)
    stepOrb(orbs[0], 0, 1 / 60, home, 0.4, 0.2, 0, span, 0, 1400, 1000, 0)
    const quietRadius = stepOrb(orbs[0], 0, 1 / 60, home, 0.4, 0.2, 0, span, 16, 1400, 1000, 0)
    const breathed = stepOrb(orbs[0], 0, 1 / 60, home, 0.4, 0.2, 0, span, 32, 1400, 1000, 1)
    expect(breathed).toBeGreaterThan(quietRadius + span * 0.01)
    const held = createOrbs()
    const hopped = createOrbs()
    const second = clusterHome(2, 1400, span, 0, 0)
    stepOrb(held[2], 2, 1 / 60, second, 0.4, 0.2, 0, span, 0, 1400, 1000, 1)
    stepOrb(hopped[2], 2, 1 / 60, second, 0.4, 0.2, 1, span, 0, 1400, 1000, 0)
    expect(Math.hypot(held[2].vx, held[2].vy)).toBeLessThan(span * 0.01)
    expect(Math.hypot(hopped[2].vx, hopped[2].vy)).toBeGreaterThan(span * 0.1)
  })

  it('gives the kick a shorter shove than metal and the hat, and lets those two settle sooner', () => {
    const span = 1000
    const excursion = (index: number) => {
      const orb = createOrbs()[index]
      const home = clusterHome(index, 1400, span, 0, 0)
      stepOrb(orb, index, 1 / 60, home, 0, 0, 0, span, 0, 1400, 1000)
      let far = 0
      for (let frame = 0; frame < 24; frame += 1) {
        stepOrb(orb, index, 1 / 60, home, 0.4, 0.5, frame === 0 ? 1 : 0, span, frame, 1400, 1000)
        far = Math.max(far, Math.hypot(orb.x - home.x, orb.y - home.y))
      }
      return { far }
    }
    const decay = (index: number) => {
      const orb = createOrbs()[index]
      const home = clusterHome(index, 1400, span, 0, 0)
      stepOrb(orb, index, 1 / 60, home, 0, 0, 0, span, 0, 1400, 1000)
      let flung = 1
      for (let frame = 0; frame < 16; frame += 1) {
        stepOrb(orb, index, 1 / 60, home, 0.3, 0.2, frame === 0 ? 1 : 0, span, frame, 1400, 1000)
        if (frame === 0) flung = Math.max(1, Math.hypot(orb.vx, orb.vy))
      }
      return Math.hypot(orb.vx, orb.vy) / flung
    }
    const kick = excursion(0)
    const metal = excursion(2)
    const hat = excursion(3)
    const tone = excursion(4)
    expect(metal.far).toBeGreaterThan(kick.far)
    expect(hat.far).toBeGreaterThan(kick.far)
    expect(tone.far).toBeGreaterThan(kick.far)
    expect(tone.far).toBeLessThan(metal.far)
    expect(decay(2)).toBeLessThan(decay(0))
    expect(decay(3)).toBeLessThan(decay(0))
    expect(kick.far).toBeLessThan(span * 0.12)
  })

  it('turns the shove on each hit and lifts a higher tone note', () => {
    const span = 1000
    const home = clusterHome(4, 1400, span, 0, 0)
    const strike = (pitch: number) => {
      const orb = createOrbs()[4]
      orb.pitch = pitch
      stepOrb(orb, 4, 1 / 60, home, 0.4, 0.5, 1, span, 0, 1400, 1000)
      return Math.atan2(orb.vy, orb.vx)
    }
    const first = strike(0)
    const again = createOrbs()[4]
    stepOrb(again, 4, 1 / 60, home, 0.4, 0.5, 1, span, 0, 1400, 1000)
    for (let frame = 0; frame < 8; frame += 1) stepOrb(again, 4, 1 / 60, home, 0.2, 0.1, 0, span, frame, 1400, 1000)
    again.vx = 0
    again.vy = 0
    stepOrb(again, 4, 1 / 60, home, 0.4, 0.5, 1, span, 0, 1400, 1000)
    const second = Math.atan2(again.vy, again.vx)
    const gap = Math.abs(Math.atan2(Math.sin(second - first), Math.cos(second - first)))
    expect(gap).toBeGreaterThan(0.08)
    expect(gap).toBeLessThan(0.5)
    const low = strike(-1)
    const high = strike(1)
    expect(high).toBeLessThan(low)
    const drum = (pitch: number) => {
      const orb = createOrbs()[0]
      orb.pitch = pitch
      const seat = clusterHome(0, 1400, span, 0, 0)
      stepOrb(orb, 0, 1 / 60, seat, 0.4, 0.5, 1, span, 0, 1400, 1000)
      return orb.vy
    }
    expect(drum(1)).toBeCloseTo(drum(-1), 4)
  })

  it('drifts within the old sway and pauses before turning back', () => {
    const span = 1000
    const orb = createOrbs()[1]
    const home = clusterHome(1, 1400, span, 0, 0)
    stepOrb(orb, 1, 1 / 60, home, 0, 0, 0, span, 0)
    let far = 0
    let paused = 0
    let run = 0
    let previous = orb.x
    let turned = false
    let lastHeading = orb.heading
    for (let frame = 0; frame < 60 * 12; frame += 1) {
      stepOrb(orb, 1, 1 / 60, home, 0, 0, 0, span, frame)
      far = Math.max(far, Math.hypot(orb.wanderX, orb.wanderY))
      const still = Math.abs(orb.x - previous) < 0.02 && Math.abs(orb.vx) < 0.4
      run = still ? run + 1 : 0
      paused = Math.max(paused, run)
      previous = orb.x
      if (Math.abs(Math.atan2(Math.sin(orb.heading - lastHeading), Math.cos(orb.heading - lastHeading))) > 0.8) turned = true
      lastHeading = orb.heading
    }
    expect(far).toBeGreaterThan(span * 0.012)
    expect(far).toBeLessThanOrEqual(span * 0.034 + 0.001)
    expect(paused).toBeGreaterThan(30)
    expect(turned).toBe(true)
  })

  it('presses a circle from below for a high pass and from above for a low pass', () => {
    const round = orbPress(80, 200, 60, 0, 0)
    expect(round).toEqual({ x: 80, y: 200, scaleX: 1, scaleY: 1 })
    const high = orbPress(80, 200, 60, 1, 0)
    expect(high.scaleY).toBeCloseTo(5 / 6)
    expect(high.y - high.scaleY * 60).toBeCloseTo(140)
    expect(high.scaleX).toBeGreaterThan(1)
    const low = orbPress(80, 200, 60, -1, 0)
    expect(low.y + low.scaleY * 60).toBeCloseTo(260)
    expect(low.y).toBeGreaterThan(200)
    const punched = orbPress(80, 200, 60, 1, 1)
    expect(punched.scaleY).toBeGreaterThan(high.scaleY)
    const lightHigh = orbPress(80, 200, 60, 1, 0, 1.15)
    expect(1 - lightHigh.scaleY).toBeCloseTo((1 - high.scaleY) * 1.15)
    expect(lightHigh.y - lightHigh.scaleY * 60).toBeCloseTo(140)
    const lightLow = orbPress(80, 200, 60, -1, 0, 1.15)
    expect(lightLow.y + lightLow.scaleY * 60).toBeCloseTo(260)
    expect(1 - lightLow.scaleY).toBeCloseTo((1 - high.scaleY) * 1.15)
  })
})
