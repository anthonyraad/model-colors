import { describe, expect, it } from 'vitest'
import { QUANTIZE_DOWNBEAT_BEATS, quantizeBarEnd, quantizeDelay } from './quantize'

describe('quantize', () => {
  it('snaps to the nearest step', () => {
    expect(quantizeDelay(0, 0.25)).toBe(0)
    expect(quantizeDelay(0.1, 0.25)).toBe(0)
    expect(quantizeDelay(0.125, 0.25)).toBeCloseTo(0.125)
    expect(quantizeDelay(0.2, 0.25)).toBeCloseTo(0.05)
    expect(quantizeDelay(4.2, 0.25)).toBeCloseTo(0.05)
    expect(quantizeDelay(-0.1, 0.25)).toBeCloseTo(0.1)
    expect(quantizeDelay(1, 0)).toBe(0)
  })

  it('waits for the end of the current bar', () => {
    expect(quantizeBarEnd(0, 4)).toBe(0)
    expect(quantizeBarEnd(4, 4)).toBe(0)
    expect(quantizeBarEnd(0.1, 4)).toBeCloseTo(3.9)
    expect(quantizeBarEnd(2, 4)).toBeCloseTo(2)
    expect(quantizeBarEnd(3.9, 4)).toBeCloseTo(0.1)
    expect(quantizeBarEnd(4.2, 4)).toBeCloseTo(3.8)
    expect(quantizeBarEnd(1, 0)).toBe(0)
  })

  it('snaps duck and stutter to the nearest downbeat 8th', () => {
    expect(QUANTIZE_DOWNBEAT_BEATS).toBe(1)
    expect(quantizeDelay(0, QUANTIZE_DOWNBEAT_BEATS)).toBe(0)
    expect(quantizeDelay(0.4, QUANTIZE_DOWNBEAT_BEATS)).toBe(0)
    expect(quantizeDelay(0.5, QUANTIZE_DOWNBEAT_BEATS)).toBeCloseTo(0.5)
    expect(quantizeDelay(0.6, QUANTIZE_DOWNBEAT_BEATS)).toBeCloseTo(0.4)
    expect(quantizeDelay(1, QUANTIZE_DOWNBEAT_BEATS)).toBe(0)
  })
})