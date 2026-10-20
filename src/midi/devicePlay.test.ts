import { describe, expect, it } from 'vitest'
import { clockGapMs } from './devicePlay'

describe('device play clock', () => {
  it('sends 24 clocks in each quarter note', () => {
    expect(clockGapMs(120)).toBeCloseTo(1000 / 48, 5)
    expect(clockGapMs(60)).toBeCloseTo(clockGapMs(120) * 2, 5)
  })

  it('uses 120 when the tempo is outside the control', () => {
    expect(clockGapMs(0)).toBe(clockGapMs(120))
    expect(clockGapMs(400)).toBe(clockGapMs(120))
  })
})
