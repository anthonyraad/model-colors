import { describe, expect, it } from 'vitest'
import { createStutterState, customStutterGate, customStutterSpan, stutterGate, stutterPhase, stutterRate, toggleStutter, toggleStutterTrig } from './stutter'

describe('tempo stutter', () => {
  it('maps the rate keys onto note divisions', () => {
    expect(stutterRate('a')?.label).toBe('1/32')
    expect(stutterRate('S')?.beats).toBe(0.25)
    expect(stutterRate('d')?.beats).toBeCloseTo(1 / 3, 5)
    expect(stutterRate('f')?.beats).toBe(0.5)
    expect(stutterRate('g')?.beats).toBe(1)
    expect(stutterRate('h')?.label).toBe('Custom')
    expect(stutterRate('h')?.custom).toBe(true)
    expect(stutterRate('z')).toBeNull()
  })

  it('restarts the custom stutter on each lit step and keeps the steps when it turns off', () => {
    expect(customStutterSpan(0.1, 0)).toBeNull()
    expect(customStutterGate(0.1, 0, 120)).toBe(1)
    const downbeat = toggleStutterTrig(0, 0)
    expect(customStutterSpan(0.1, downbeat)?.span).toBeCloseTo(4)
    expect(customStutterGate(0, downbeat, 120)).toBe(1)
    const halves = toggleStutterTrig(toggleStutterTrig(0, 0), 16)
    expect(customStutterSpan(0.1, halves)?.span).toBeCloseTo(2)
    expect(customStutterSpan(2.1, halves)?.into).toBeCloseTo(0.1)
    expect(customStutterGate(2, halves, 120)).toBe(1)
    const thirtySecond = toggleStutterTrig(toggleStutterTrig(0, 0), 1)
    expect(customStutterSpan(0.05, thirtySecond)?.span).toBeCloseTo(0.125)
    const last = toggleStutterTrig(0, 31)
    expect(last).toBe(-2147483648)
    expect(customStutterSpan(3.9, toggleStutterTrig(last, 0))?.span).toBeCloseTo(0.125)
    expect(customStutterSpan(3.9, toggleStutterTrig(last, 0))?.into).toBeCloseTo(0.025)
    expect(toggleStutterTrig(last, 31)).toBe(0)
    const state = createStutterState()
    state.trigs = halves
    toggleStutter(state, stutterRate('h')!)
    expect(state.custom).toBe(true)
    expect(state.label).toBe('Custom')
    toggleStutter(state, stutterRate('h')!)
    expect(state.custom).toBe(false)
    expect(state.trigs).toBe(halves)
  })

  it('selects a rate without inventing a downbeat', () => {
    const state = createStutterState()
    toggleStutter(state, stutterRate('s')!)
    expect(state.label).toBe('1/16')
    expect(state.division).toBe(0.25)
    toggleStutter(state, stutterRate('s')!)
    expect(state.division).toBe(0)
    expect(state.label).toBe('')
  })

  it('restarts on the division, not on an arbitrary beat', () => {
    expect(stutterPhase(2, 0.25)).toBeCloseTo(0, 5)
    expect(stutterPhase(2.125, 0.25)).toBeCloseTo(0.5, 5)
    expect(stutterGate(2, 0.25, 120)).toBe(1)
    expect(stutterGate(2.2, 0.25, 120)).toBeLessThan(0.5)
    expect(stutterGate(0, 0, 120)).toBe(1)
  })
})