import { describe, expect, it } from 'vitest'
import {
  acceptPatternInput,
  emptyPatternChord,
  PATTERN_FULL_FALLBACK_MS,
  PATTERN_SINGLE_FALLBACK_MS,
  stepPatternChord,
  type PatternChord,
  type PatternKeyEvent
} from './patternChord'

function press(chord: PatternChord, event: PatternKeyEvent) {
  return stepPatternChord(chord, event)
}

describe('pattern chord', () => {
  it('sends on Shift release even when the modifier flag stays true and the digit never reported Shift', () => {
    let chord = emptyPatternChord()
    chord = press(chord, { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', shift: true }).chord
    const digit = press(chord, { type: 'keyDown', code: 'Digit2', key: '@', shift: false })
    expect(digit.capture).toBe(true)
    expect(digit.slot).toBeNull()
    expect(digit.fallbackMs).toBe(PATTERN_SINGLE_FALLBACK_MS)
    const released = press(digit.chord, { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', shift: true })
    expect(released.slot).toBe(2)
    expect(released.chord.digits).toBe('')
  })

  it('waits for Shift release before a two-digit pattern and ignores 17', () => {
    let chord = emptyPatternChord()
    chord = press(chord, { type: 'keyDown', code: 'ShiftRight', key: 'Shift', shift: false }).chord
    chord = press(chord, { type: 'keyDown', code: 'Digit1', key: '!', shift: false }).chord
    const second = press(chord, { type: 'keyDown', code: 'Digit2', key: '@', shift: false })
    expect(second.slot).toBeNull()
    expect(second.fallbackMs).toBe(PATTERN_FULL_FALLBACK_MS)
    const held = press(second.chord, { type: 'keyUp', code: 'Digit2', key: '@', shift: true })
    expect(held.slot).toBeNull()
    expect(press(second.chord, { type: 'keyUp', code: 'ShiftRight', key: 'Shift', shift: true }).slot).toBe(12)

    let tooFar = emptyPatternChord()
    tooFar = press(tooFar, { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', shift: true }).chord
    tooFar = press(tooFar, { type: 'keyDown', code: 'Digit1', key: '1', shift: true }).chord
    tooFar = press(tooFar, { type: 'keyDown', code: 'Digit7', key: '7', shift: true }).chord
    expect(press(tooFar, { type: 'keyUp', key: 'Shift', code: '', shift: true }).slot).toBeNull()
  })

  it('sends a finished number when the Shift keyup never arrives and the digit keyup says Shift is up', () => {
    let chord = emptyPatternChord()
    chord = press(chord, { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', shift: true }).chord
    chord = press(chord, { type: 'keyDown', code: 'Numpad3', key: '3', shift: false }).chord
    chord = press(chord, { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', shift: true }).chord
    const late = press(chord, { type: 'keyUp', code: 'Numpad3', key: '3', shift: false })
    expect(late.slot).toBeNull()

    let missed = emptyPatternChord()
    missed = press(missed, { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', shift: true }).chord
    missed = press(missed, { type: 'keyDown', code: 'Digit4', key: '4', shift: true }).chord
    missed = { ...missed, shifts: 0 }
    expect(press(missed, { type: 'keyUp', code: 'Digit4', key: '4', shift: false }).slot).toBe(4)
  })

  it('counts Shift from rawKeyDown and ignores the duplicate keyDown', () => {
    const rawDown = new Set<string>()
    expect(acceptPatternInput('rawKeyDown', 'ShiftLeft', rawDown)).toBe('keyDown')
    expect(acceptPatternInput('keyDown', 'ShiftLeft', rawDown)).toBeNull()
    expect(acceptPatternInput('rawKeyDown', 'Digit1', rawDown)).toBe('keyDown')
    expect(acceptPatternInput('keyDown', 'Digit1', rawDown)).toBeNull()
    expect(acceptPatternInput('char', 'Digit1', rawDown)).toBeNull()
    expect(acceptPatternInput('keyUp', 'Digit1', rawDown)).toBe('keyUp')
    expect(acceptPatternInput('keyDown', 'Digit1', rawDown)).toBe('keyDown')
  })

  it('leaves unshifted digits and chords with Ctrl alone', () => {
    const plain = press(emptyPatternChord(), { type: 'keyDown', code: 'Digit1', key: '1', shift: false })
    expect(plain.capture).toBe(false)
    expect(plain.chord.digits).toBe('')
    let chord = emptyPatternChord()
    chord = press(chord, { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', shift: true }).chord
    chord = press(chord, { type: 'keyDown', code: 'Digit5', key: '%', shift: true }).chord
    const cancelled = press(chord, { type: 'keyDown', code: 'KeyC', key: 'c', shift: true, control: true })
    expect(cancelled.slot).toBeNull()
    expect(cancelled.chord.digits).toBe('')
    expect(cancelled.fallbackMs).toBeNull()
  })
})
