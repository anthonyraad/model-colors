import { describe, expect, it } from 'vitest'
import {
  applyFilterEdge,
  catchFilter,
  filterCutoff,
  filterGesture,
  filterSections,
  FILTER_TRAVEL_SECONDS,
  projectFilter,
  scheduleFilterReset,
  stepFilter
} from './outputFilter'

describe('output filter gestures', () => {
  it('uses a flat slope by default and the usual resonance steps', () => {
    expect(filterSections(12, 'none')).toEqual([0.7071067811865476])
    expect(filterSections(24, 'none')).toEqual([0.541196100146197, 1.3065629648763766])
    expect(filterSections(12, 'low')).toEqual([1.5])
    expect(filterSections(24, 'medium')).toEqual([4, 0.7071067811865476])
    expect(filterSections(24, 'high')).toEqual([10, 0.7071067811865476])
  })

  it('maps the arrow keys onto one sweep', () => {
    expect(filterGesture({ up: true, down: false, right: false })).toBe('high')
    expect(filterGesture({ up: false, down: true, right: false })).toBe('low')
    expect(filterGesture({ up: false, down: true, right: true })).toBe('open-high')
    expect(filterGesture({ up: true, down: false, right: true })).toBe('open-low')
    expect(filterGesture({ up: false, down: false, right: true })).toBe('hold')
    expect(filterGesture({ up: true, down: true, right: true })).toBe('hold')
  })

  it('opens from the far end and stops at bypass', () => {
    expect(applyFilterEdge(-0.4, 'open-high')).toBe(1)
    expect(applyFilterEdge(0.4, 'open-low')).toBe(-1)
    expect(applyFilterEdge(0.6, 'reset')).toBe(0)
    let position = applyFilterEdge(-1, 'open-high')
    position = stepFilter(position, 'open-high', FILTER_TRAVEL_SECONDS)
    expect(position).toBe(0)
    position = stepFilter(position, 'open-high', 1)
    expect(position).toBe(0)
    position = applyFilterEdge(1, 'open-low')
    position = stepFilter(position, 'open-low', FILTER_TRAVEL_SECONDS + 1)
    expect(position).toBe(0)
  })

  it('lets a plain sweep cross neutral and finish a full travel in one hold', () => {
    expect(stepFilter(-0.5, 'high', FILTER_TRAVEL_SECONDS)).toBeCloseTo(0.5)
    expect(stepFilter(0, 'high', FILTER_TRAVEL_SECONDS)).toBe(1)
    expect(stepFilter(0, 'low', FILTER_TRAVEL_SECONDS)).toBe(-1)
    expect(stepFilter(0.25, 'hold', 4)).toBe(0.25)
  })

  it('keeps a held sweep while the host is not playing, then parks it on release', () => {
    const rising = catchFilter(null, 'high', 1_000)
    const parked = catchFilter(rising, 'hold', 1_000 + FILTER_TRAVEL_SECONDS * 500)
    expect(parked.position).toBeCloseTo(0.5)
    expect(parked.move).toBe('hold')
    expect(projectFilter(parked, 1_000 + FILTER_TRAVEL_SECONDS * 1000).position).toBeCloseTo(0.5)
  })

  it('snaps a zero reset and quantizes a note-length return onto the bar', () => {
    const bent = { move: 'hold' as const, position: 0.8, at: 0, returnFrom: 0, returnWait: 0, returnSpan: 0 }
    expect(scheduleFilterReset(bent, 1_000, 0, 1.3, 120).position).toBe(0)
    const free = scheduleFilterReset(bent, 1_000, 1, null, 120)
    expect(free.returnWait).toBe(0)
    expect(free.returnSpan).toBeCloseTo(0.5)
    const late = scheduleFilterReset(bent, 1_000, 1, 1.25, 120)
    expect(late.returnWait).toBeCloseTo(0.375)
    expect(late.returnSpan).toBeCloseTo(0.5)
    expect(projectFilter(late, 1_000 + 200).position).toBeCloseTo(0.8)
    const mid = projectFilter(late, 1_000 + 375 + 250)
    expect(mid.position).toBeCloseTo(0.4)
    expect(projectFilter(late, 1_000 + 375 + 500).move).toBe('hold')
    const low = scheduleFilterReset(
      { move: 'hold', position: -0.6, at: 0, returnFrom: 0, returnWait: 0, returnSpan: 0 },
      2_000,
      0.25,
      0,
      120
    )
    expect(low.returnWait).toBe(0)
    expect(projectFilter(low, 2_000 + 62.5).position).toBeCloseTo(-0.3)
  })

  it('is silent at neutral and reaches a strong cutoff at either end', () => {
    expect(filterCutoff(0, 48000)).toEqual({ kind: 'bypass' })
    expect(filterCutoff(1, 48000)).toEqual({ kind: 'highpass', hz: 10000 })
    expect(filterCutoff(-1, 48000)).toEqual({ kind: 'lowpass', hz: 100 })
    const mid = filterCutoff(0.5, 48000)
    expect(mid.kind).toBe('highpass')
    if (mid.kind === 'highpass') expect(mid.hz).toBeCloseTo(Math.sqrt(20 * 10000))
  })
})
