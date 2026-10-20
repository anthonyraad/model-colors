import { describe, expect, it } from 'vitest'
import { duckRate, createDuckState } from './duck'
import { armCtrl, createHoldMode, markCtrlChord, pressHeld, releaseHeld, tapCtrl, writeDuck } from './hold'
import { stutterRate } from './stutter'

describe('hold mode', () => {
  it('flips on a bare Ctrl tap and ignores a chord', () => {
    const mode = createHoldMode()
    armCtrl(mode)
    expect(tapCtrl(mode)).toBe(true)
    expect(mode.enabled).toBe(true)
    armCtrl(mode)
    markCtrlChord(mode)
    expect(tapCtrl(mode)).toBe(false)
    expect(mode.enabled).toBe(true)
  })

  it('keeps a rate while its key is down and clears it on release', () => {
    const held = [] as NonNullable<ReturnType<typeof duckRate>>[]
    const state = createDuckState()
    const sixteenth = duckRate('z')!
    const quarter = duckRate('c')!
    writeDuck(state, pressHeld(held, sixteenth))
    expect(state.label).toBe('1/16')
    writeDuck(state, pressHeld(held, quarter))
    expect(state.label).toBe('1/4')
    writeDuck(state, releaseHeld(held, quarter.label) ?? null)
    expect(state.label).toBe('1/16')
    expect(releaseHeld(held, stutterRate('a')!.label)).toBeUndefined()
    expect(state.label).toBe('1/16')
    writeDuck(state, releaseHeld(held, sixteenth.label) ?? null)
    expect(state.division).toBe(0)
    expect(state.label).toBe('')
  })
})