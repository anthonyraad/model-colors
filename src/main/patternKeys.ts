import type { WebContents } from 'electron'
import { acceptPatternInput, emptyPatternChord, stepPatternChord, type PatternChord } from '../midi/patternChord'
import { patternSlotFromDigits } from '../midi/routing'

/**
 * Reads Shift chords from the OS key stream, before the page can drop the Shift release.
 * A focused field does not block the chord.
 */
export function attachPatternKeys(
  contents: WebContents,
  deliver: (slot: number) => void
): { stop: () => void; flush: () => void; cancel: () => void } {
  let chord: PatternChord = emptyPatternChord()
  let timer: ReturnType<typeof setTimeout> | null = null
  const rawDown = new Set<string>()

  const clearTimer = () => {
    if (timer == null) return
    clearTimeout(timer)
    timer = null
  }

  const deliverSlot = (slot: number | null) => {
    clearTimer()
    chord = emptyPatternChord()
    if (slot != null) deliver(slot)
  }

  const arm = (ms: number) => {
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      deliverSlot(patternSlotFromDigits(chord.digits))
    }, ms)
  }

  const onInput = (event: Electron.Event, input: Electron.Input) => {
    const type = acceptPatternInput(input.type, input.code, rawDown)
    if (type == null) return
    const step = stepPatternChord(chord, {
      type,
      code: input.code,
      key: input.key,
      shift: input.shift,
      repeat: input.isAutoRepeat,
      control: input.control,
      alt: input.alt,
      meta: input.meta
    })
    chord = step.chord
    if (step.capture) event.preventDefault()
    if (step.fallbackMs === null) clearTimer()
    else if (typeof step.fallbackMs === 'number') arm(step.fallbackMs)
    if (step.slot != null) deliver(step.slot)
  }

  contents.on('before-input-event', onInput)
  return {
    stop: () => {
      clearTimer()
      contents.removeListener('before-input-event', onInput)
    },
    flush: () => deliverSlot(patternSlotFromDigits(chord.digits)),
    cancel: () => deliverSlot(null)
  }
}

/** Space starts and stops the sequencer even when a field or menu has focus. */
export function attachTransportKey(contents: WebContents, toggle: () => void): () => void {
  let sawRaw = false
  const onInput = (event: Electron.Event, input: Electron.Input) => {
    if (input.code !== 'Space' && input.key !== ' ') return
    if (input.type === 'keyUp') {
      sawRaw = false
      return
    }
    const press = input.type === 'rawKeyDown' || input.type === 'keyDown'
    if (!press) return
    if (input.type === 'rawKeyDown') sawRaw = true
    else if (sawRaw) return
    if (input.isAutoRepeat || input.control || input.alt || input.meta) return
    event.preventDefault()
    toggle()
  }
  contents.on('before-input-event', onInput)
  return () => contents.removeListener('before-input-event', onInput)
}
