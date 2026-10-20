import { fadeBarsOf, INSERT_COUNT, type FadeBars, type InsertSlot } from './inserts'
import type { ReverseBars, TapeSpeed } from './motion'
import type { FilterResetBeats, FilterResonanceId, FilterSlopeDb } from './outputFilter'

export const CONTROLS_PRESET_VERSION = 1

export type ControlsAdvanced = {
  duckTrigs: number
  stutterTrigs: number
  duckQuantize: boolean
  stutterQuantize: boolean
  reverseQuantize: boolean
  reverseBars: ReverseBars
  reverseOver: boolean
  tapeQuantize: boolean
  tapeOver: boolean
  tapeSpeed: TapeSpeed
  filterReset: FilterResetBeats
  filterSlope: FilterSlopeDb
  filterResonance: FilterResonanceId
}

export type PresetSlot = {
  path: string | null
  name: string | null
  bypass: boolean
  fadeBars: FadeBars
  fadeOutBars: FadeBars
  look: boolean
  /** Opaque plug-in state from the insert host. Null when the plug-in had nothing to store. */
  state: string | null
}

export type ControlsPreset = {
  name: string
  savedAt: string
  inputId: string
  outputId: string
  slots: PresetSlot[]
  advanced: ControlsAdvanced
}

export function emptyAdvanced(): ControlsAdvanced {
  return {
    duckTrigs: 0,
    stutterTrigs: 0,
    duckQuantize: false,
    stutterQuantize: false,
    reverseQuantize: false,
    reverseBars: 4,
    reverseOver: false,
    tapeQuantize: false,
    tapeOver: false,
    tapeSpeed: 'medium',
    filterReset: 0,
    filterSlope: 12,
    filterResonance: 'none'
  }
}

export function buildPreset(input: {
  name: string
  savedAt: string
  inputId: string
  outputId: string
  slots: readonly InsertSlot[]
  states: readonly (string | null)[]
  advanced: ControlsAdvanced
}): ControlsPreset {
  let stateIndex = 0
  const slots = Array.from({ length: INSERT_COUNT }, (_, index) => {
    const slot = input.slots[index]
    const path = slot?.path ?? null
    const state = path ? (input.states[stateIndex++] ?? null) : null
    return {
      path,
      name: slot?.name ?? null,
      bypass: slot?.bypass ?? false,
      fadeBars: fadeBarsOf(slot?.fadeBars ?? 0),
      fadeOutBars: fadeBarsOf(slot?.fadeOutBars ?? 0),
      look: slot?.look ?? false,
      state: typeof state === 'string' && state.length > 0 ? state : null
    }
  })
  return {
    name: input.name.trim(),
    savedAt: input.savedAt,
    inputId: input.inputId,
    outputId: input.outputId,
    slots,
    advanced: { ...input.advanced }
  }
}

export function slotsFromPreset(preset: ControlsPreset): InsertSlot[] {
  return preset.slots.map((slot) => ({
    path: slot.path,
    name: slot.name,
    bypass: slot.path ? true : slot.bypass,
    fadeBars: slot.fadeBars,
    fadeOutBars: slot.fadeOutBars,
    look: slot.path ? false : slot.look
  }))
}

export function statesFromPreset(preset: ControlsPreset): (string | null)[] {
  return preset.slots.filter((slot) => slot.path).map((slot) => slot.state)
}

/** Replace a preset with the same name, or add it. Names are matched without case. */
export function upsertPreset(presets: readonly ControlsPreset[], next: ControlsPreset): ControlsPreset[] {
  const name = next.name.trim().toLowerCase()
  const kept = presets.filter((preset) => preset.name.trim().toLowerCase() !== name)
  return [...kept, { ...next, name: next.name.trim() }]
}

export function removePreset(presets: readonly ControlsPreset[], name: string): ControlsPreset[] {
  const key = name.trim().toLowerCase()
  return presets.filter((preset) => preset.name.trim().toLowerCase() !== key)
}

export function parsePresetDocument(value: unknown): ControlsPreset[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { presets?: unknown }).presets)
      ? (value as { presets: unknown[] }).presets
      : []
  const presets: ControlsPreset[] = []
  for (const item of list) {
    const preset = parsePreset(item)
    if (preset) presets.push(preset)
  }
  return presets
}

function parsePreset(value: unknown): ControlsPreset | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!name) return null
  const advanced = { ...emptyAdvanced(), ...parseAdvanced(record.advanced) }
  const rawSlots = Array.isArray(record.slots) ? record.slots : []
  const slots = Array.from({ length: INSERT_COUNT }, (_, index) => parseSlot(rawSlots[index]))
  return {
    name,
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
    inputId: typeof record.inputId === 'string' ? record.inputId : '',
    outputId: typeof record.outputId === 'string' ? record.outputId : '',
    slots,
    advanced
  }
}

function parseSlot(value: unknown): PresetSlot {
  if (!value || typeof value !== 'object') return { path: null, name: null, bypass: false, fadeBars: 0, fadeOutBars: 0, look: false, state: null }
  const record = value as Record<string, unknown>
  const path = typeof record.path === 'string' && record.path.length > 0 ? record.path : null
  return {
    path,
    name: typeof record.name === 'string' && record.name.length > 0 ? record.name : null,
    bypass: record.bypass === true,
    fadeBars: fadeBarsOf(typeof record.fadeBars === 'number' ? record.fadeBars : 0),
    fadeOutBars: fadeBarsOf(typeof record.fadeOutBars === 'number' ? record.fadeOutBars : 0),
    look: record.look === true,
    state: path && typeof record.state === 'string' && record.state.length > 0 ? record.state : null
  }
}

function parseAdvanced(value: unknown): Partial<ControlsAdvanced> {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const bars = record.reverseBars
  const speed = record.tapeSpeed
  const reset = record.filterReset
  const slope = record.filterSlope
  const resonance = record.filterResonance
  return {
    duckTrigs: int32(record.duckTrigs),
    stutterTrigs: int32(record.stutterTrigs),
    duckQuantize: record.duckQuantize === true,
    stutterQuantize: record.stutterQuantize === true,
    reverseQuantize: record.reverseQuantize === true,
    reverseBars: bars === 1 || bars === 2 || bars === 4 || bars === 8 ? bars : 4,
    reverseOver: record.reverseOver === true,
    tapeQuantize: record.tapeQuantize === true,
    tapeOver: record.tapeOver === true,
    tapeSpeed: speed === 'slow' || speed === 'medium' || speed === 'fast' ? speed : 'medium',
    filterReset: reset === 0 || reset === 0.25 || reset === 0.5 || reset === 1 ? reset : 0,
    filterSlope: slope === 24 ? 24 : 12,
    filterResonance: resonance === 'low' || resonance === 'medium' || resonance === 'high' || resonance === 'none' ? resonance : 'none'
  }
}

function int32(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return value | 0
}
