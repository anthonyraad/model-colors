import type { DuckRate, DuckState } from './duck'
import type { StutterRate, StutterState } from './stutter'

export type HoldMode = {
  enabled: boolean
  /** Ctrl was used with another key, so releasing it should not change the mode. */
  chord: boolean
}

export function createHoldMode(): HoldMode {
  return { enabled: false, chord: false }
}

/** A fresh Ctrl press. A following chord can cancel the tap. */
export function armCtrl(mode: HoldMode): void {
  mode.chord = false
}

export function markCtrlChord(mode: HoldMode): void {
  mode.chord = true
}

/** Release of Ctrl. A bare tap flips hold mode. A chord does not. */
export function tapCtrl(mode: HoldMode): boolean {
  if (mode.chord) {
    mode.chord = false
    return false
  }
  mode.enabled = !mode.enabled
  return true
}

/** The newest held rate wins. Pressing it again keeps it on top. */
export function pressHeld<T extends { label: string }>(held: T[], rate: T): T {
  const index = held.findIndex((item) => item.label === rate.label)
  if (index >= 0) held.splice(index, 1)
  held.push(rate)
  return rate
}

/**
 * Drop a released rate. Undefined means that key was not held, so a latched
 * rate from toggle mode stays put. Null means nothing is held anymore.
 */
export function releaseHeld<T extends { label: string }>(held: T[], label: string): T | null | undefined {
  const index = held.findIndex((item) => item.label === label)
  if (index < 0) return undefined
  held.splice(index, 1)
  return held.length > 0 ? held[held.length - 1]! : null
}

export function writeDuck(state: DuckState, rate: DuckRate | null): void {
  state.division = rate?.beats ?? 0
  state.label = rate?.label ?? ''
  state.custom = rate?.custom === true
}

export function writeStutter(state: StutterState, rate: StutterRate | null): void {
  state.division = rate?.beats ?? 0
  state.label = rate?.label ?? ''
  state.custom = rate?.custom === true
}
