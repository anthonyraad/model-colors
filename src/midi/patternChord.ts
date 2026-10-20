import { patternDigit, patternSlotFromDigits, pushPatternDigit } from './routing'

/** One digit may still be the start of 10–16, so the safety send waits. */
export const PATTERN_SINGLE_FALLBACK_MS = 1100
/** Two digits already name the pattern, so a missing Shift release sends quickly. */
export const PATTERN_FULL_FALLBACK_MS = 400

export type PatternChord = { digits: string; shifts: number }

export type PatternKeyEvent = {
  type: 'keyDown' | 'keyUp'
  code: string
  key: string
  shift: boolean
  repeat?: boolean
  control?: boolean
  alt?: boolean
  meta?: boolean
}

export type ChordStep = {
  chord: PatternChord
  slot: number | null
  capture: boolean
  /** A number arms a safety send. Null clears it. Undefined leaves the timer alone. */
  fallbackMs: number | null | undefined
}

export function emptyPatternChord(): PatternChord {
  return { digits: '', shifts: 0 }
}

/**
 * Electron delivers Shift as rawKeyDown and then sometimes a second keyDown for the same press.
 * The second one must not be counted again.
 */
export function acceptPatternInput(type: string, code: string, rawDown: Set<string>): 'keyDown' | 'keyUp' | null {
  if (type === 'rawKeyDown') {
    rawDown.add(code)
    return 'keyDown'
  }
  if (type === 'keyDown') return rawDown.has(code) ? null : 'keyDown'
  if (type === 'keyUp') {
    rawDown.delete(code)
    return 'keyUp'
  }
  return null
}

function shiftKey(event: PatternKeyEvent): boolean {
  return event.key === 'Shift' || event.code === 'ShiftLeft' || event.code === 'ShiftRight'
}

function digitOf(event: PatternKeyEvent): string | null {
  return patternDigit(event.code) ?? (/^[0-9]$/.test(event.key) ? event.key : null)
}

function fallbackFor(digits: string): number | null {
  if (digits.length >= 2) return PATTERN_FULL_FALLBACK_MS
  if (digits.length === 1) return PATTERN_SINGLE_FALLBACK_MS
  return null
}

/**
 * Shift is tracked from its own keydown, because the modifier flag on the digit
 * and on the Shift keyup is unreliable. The number is sent when Shift goes up.
 */
export function stepPatternChord(chord: PatternChord, event: PatternKeyEvent): ChordStep {
  if (event.control || event.alt || event.meta) {
    return { chord: emptyPatternChord(), slot: null, capture: false, fallbackMs: null }
  }
  if (shiftKey(event)) {
    if (event.type === 'keyDown') {
      if (event.repeat) return { chord, slot: null, capture: false, fallbackMs: undefined }
      return {
        chord: { digits: chord.digits, shifts: chord.shifts + 1 },
        slot: null,
        capture: false,
        fallbackMs: undefined
      }
    }
    return { chord: emptyPatternChord(), slot: patternSlotFromDigits(chord.digits), capture: false, fallbackMs: null }
  }
  const digit = digitOf(event)
  const shifted = chord.shifts > 0 || event.shift
  if (event.type === 'keyDown' && digit && shifted && !event.repeat) {
    const digits = pushPatternDigit(chord.digits, digit)
    return { chord: { digits, shifts: chord.shifts }, slot: null, capture: true, fallbackMs: fallbackFor(digits) }
  }
  if (event.type === 'keyUp' && digit && chord.digits.length > 0 && chord.shifts === 0 && !event.shift) {
    return { chord: emptyPatternChord(), slot: patternSlotFromDigits(chord.digits), capture: false, fallbackMs: null }
  }
  if (chord.digits.length > 0 && shifted) {
    return { chord, slot: null, capture: false, fallbackMs: fallbackFor(chord.digits) }
  }
  return { chord, slot: null, capture: false, fallbackMs: undefined }
}
