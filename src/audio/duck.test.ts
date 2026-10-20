import { describe, expect, it } from 'vitest'
import { createDuckState, customDuckGain, duckGain, duckPosition, duckRate, noteDuckClock, toggleDuck, toggleDuckTrig } from './duck'

describe('tempo duck', () => {
  it('maps the rate keys onto note divisions', () => {
    expect(duckRate('z')?.label).toBe('1/16')
    expect(duckRate('X')?.beats).toBe(0.5)
    expect(duckRate('c')?.beats).toBe(1)
    expect(duckRate('v')?.beats).toBe(2)
    expect(duckRate('b')?.beats).toBe(4)
    expect(duckRate('n')?.label).toBe('Custom')
    expect(duckRate('n')?.custom).toBe(true)
    expect(duckRate('q')).toBeNull()
  })

  it('ducks only the lit custom trigs and keeps them when the rate turns off', () => {
    expect(customDuckGain(0.01, 0, 120)).toBe(1)
    const downbeat = 1
    expect(customDuckGain(0.01, downbeat, 120)).toBeLessThan(0.1)
    expect(customDuckGain(3.9, downbeat, 120)).toBeGreaterThan(0.9)
    const offbeats = toggleDuckTrig(toggleDuckTrig(0, 0), 8)
    expect(customDuckGain(0.01, offbeats, 120)).toBeLessThan(0.1)
    expect(customDuckGain(1.9, offbeats, 120)).toBeGreaterThan(0.6)
    expect(customDuckGain(2.01, offbeats, 120)).toBeLessThan(0.1)
    const middle = toggleDuckTrig(0, 4)
    expect(customDuckGain(1.01, middle, 120)).toBeLessThan(0.1)
    expect(customDuckGain(0.5, middle, 120)).toBeGreaterThan(0.6)
    const state = createDuckState()
    state.trigs = middle
    toggleDuck(state, duckRate('n')!)
    expect(state.custom).toBe(true)
    expect(state.label).toBe('Custom')
    toggleDuck(state, duckRate('n')!)
    expect(state.custom).toBe(false)
    expect(state.trigs).toBe(middle)
    toggleDuck(state, duckRate('c')!)
    expect(state.custom).toBe(false)
    expect(state.division).toBe(1)
  })

  it('drops on the beat and opens again before the next one', () => {
    expect(duckGain(0, 0, 120)).toBe(1)
    expect(duckGain(0.01, 1, 120)).toBeLessThan(0.1)
    expect(duckGain(0.5, 1, 120)).toBeGreaterThan(0.6)
    expect(duckGain(0.98, 1, 120)).toBeGreaterThan(0.9)
    expect(duckGain(0.125, 0.25, 120)).toBeGreaterThan(duckGain(0.02, 0.25, 120))
  })

  it('selects a rate without moving the grid', () => {
    const state = createDuckState()
    const before = duckPosition(state, 1_000, 120)
    expect(before.running).toBe(false)
    toggleDuck(state, duckRate('c')!)
    const after = duckPosition(state, 1_000, 120)
    expect(state.label).toBe('1/4')
    expect(after.beats).toBeCloseTo(before.beats, 5)
    const later = duckPosition(state, 2_000, 120)
    expect(later.beats - before.beats).toBeCloseTo(2, 5)
    expect(later.running).toBe(false)
    toggleDuck(state, duckRate('c')!)
    expect(state.division).toBe(0)
  })

  it('keeps 1/1 on the bar when the key lands mid-bar', () => {
    const state = createDuckState()
    noteDuckClock(state, 'start', 1_000, 'device')
    for (let i = 0; i < 48; i++) noteDuckClock(state, 'clock', 1_000 + (i + 1) * 21, 'device')
    const at = 1_000 + 48 * 21
    const before = duckPosition(state, at, 90)
    expect(before.running).toBe(true)
    expect(before.beats).toBeCloseTo(2, 5)
    toggleDuck(state, duckRate('b')!)
    const after = duckPosition(state, at, 90)
    expect(after.beats).toBeCloseTo(before.beats, 5)
    expect(state.division).toBe(4)
    expect(duckGain(after.beats, state.division, after.bpm)).toBeGreaterThan(0.6)
    expect(duckGain(0.02, 4, 120)).toBeLessThan(0.15)
    expect(duckGain(3.92, 4, 120)).toBeGreaterThan(0.9)
  })

  it('ducks the next bar from MIDI Start, not from a clock that arrived first', () => {
    const state = createDuckState()
    noteDuckClock(state, 'clock', 500, 'device')
    expect(duckPosition(state, 500, 120).running).toBe(false)
    noteDuckClock(state, 'start', 1_000, 'device')
    expect(duckPosition(state, 1_000, 120).beats).toBe(0)
    for (let i = 0; i < 96; i++) noteDuckClock(state, 'clock', 1_000 + (i + 1) * 21, 'device')
    expect(duckPosition(state, 1_000 + 96 * 21, 120).beats).toBeCloseTo(4, 5)
  })

  it('follows the app transport until the Model:Cycles clock is heard', () => {
    const state = createDuckState()
    noteDuckClock(state, 'start', 1_000, 'app')
    expect(duckPosition(state, 1_000, 120).beats).toBe(0)
    expect(duckPosition(state, 1_000, 120).running).toBe(true)
    noteDuckClock(state, 'clock', 1_021, 'app')
    noteDuckClock(state, 'start', 5_000, 'device')
    noteDuckClock(state, 'clock', 5_021, 'device')
    noteDuckClock(state, 'clock', 5_042, 'app')
    expect(state.clockBeats).toBeCloseTo(1 / 24, 5)
  })

  it('keeps the pump on the incoming clock', () => {
    const state = createDuckState()
    noteDuckClock(state, 'start', 2_000, 'device')
    noteDuckClock(state, 'clock', 2_500, 'device')
    const place = duckPosition(state, 2_500, 100)
    expect(place.beats).toBeCloseTo(1 / 24)
    expect(place.bpm).not.toBe(100)
  })
})
