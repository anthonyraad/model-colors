export const INSERT_COUNT = 6

/** Physical keys for slots 1–6, in order. */
export const INSERT_KEYS = ['q', 'w', 'e', 'r', 't', 'y'] as const

/** Bars an insert takes to fade in, and to fade back out. */
export const FADE_BARS = [0, 1, 2, 4] as const

export type FadeBars = (typeof FADE_BARS)[number]

export type InsertPlugin = {
  name: string
  path: string
  vendor: string
}

export type AudioEndpoint = {
  id: string
  name: string
  state?: string
  channels?: number
}

/** Visual treatment for slots 1–6, in insert order. */
export const INSERT_LOOKS = ['Braid', 'Bloom', 'Split', 'Scratch', 'Sweep', 'Drown'] as const

/** Names for the insert row and the visualizer caption. */
export const INSERT_LOOK_SHORT = ['Braid', 'Bloom', 'Split', 'Scratch', 'Sweep', 'Drown'] as const

/** What the visualizer needs from one insert row: whether its look is on, and how many bars it fades. */
export type LookGate = {
  on: boolean
  fadeBars: FadeBars
  fadeOutBars: FadeBars
}

export type InsertSlot = {
  path: string | null
  name: string | null
  bypass: boolean
  fadeBars: FadeBars
  /** Bars the effect takes to fade back out when it is turned off. */
  fadeOutBars: FadeBars
  /** The picture treatment for this slot. On when the insert is in, and also on its own when the slot is empty. */
  look: boolean
}

export function fadeBarsOf(value: number): FadeBars {
  return value === 1 || value === 2 || value === 4 ? value : 0
}

export function emptySlots(): InsertSlot[] {
  return Array.from({ length: INSERT_COUNT }, () => ({ path: null, name: null, bypass: false, fadeBars: 0, fadeOutBars: 0, look: false }))
}

export function assignSlot(slots: readonly InsertSlot[], index: number, plugin: InsertPlugin): InsertSlot[] {
  return slots.map((slot, slotIndex) =>
    slotIndex === index ? { path: plugin.path, name: plugin.name, bypass: false, fadeBars: slot.fadeBars, fadeOutBars: slot.fadeOutBars, look: true } : slot
  )
}

/** Move a loaded insert to another slot. The other slots shift to fill the gap. An empty slot cannot be dragged. */
export function moveSlotTo(slots: readonly InsertSlot[], from: number, to: number): InsertSlot[] {
  const slot = slots[from]
  if (!slot?.path || to === from || to < 0 || to >= slots.length) return slots.slice()
  const next = slots.slice()
  const [moved] = next.splice(from, 1)
  if (!moved) return slots.slice()
  next.splice(to, 0, moved)
  return next
}

export function clearSlot(slots: readonly InsertSlot[], index: number): InsertSlot[] {
  return slots.map((slot, slotIndex) =>
    slotIndex === index ? { path: null, name: null, bypass: false, fadeBars: slot.fadeBars, fadeOutBars: slot.fadeOutBars, look: false } : slot
  )
}

export function setFadeBars(slots: readonly InsertSlot[], index: number, bars: FadeBars): InsertSlot[] {
  return slots.map((slot, slotIndex) => (slotIndex === index ? { ...slot, fadeBars: bars } : slot))
}

export function setFadeOutBars(slots: readonly InsertSlot[], index: number, bars: FadeBars): InsertSlot[] {
  return slots.map((slot, slotIndex) => (slotIndex === index ? { ...slot, fadeOutBars: bars } : slot))
}

export function toggleBypass(slots: readonly InsertSlot[], index: number): InsertSlot[] {
  return slots.map((slot, slotIndex) =>
    slotIndex === index ? { ...slot, bypass: !slot.bypass, look: slot.bypass } : slot
  )
}

/** The insert key. A loaded slot comes in and out with its picture. An empty slot only toggles the picture. */
export function togglePosition(slots: readonly InsertSlot[], index: number): InsertSlot[] {
  const slot = slots[index]
  if (!slot) return slots.slice()
  if (slot.path) return toggleBypass(slots, index)
  return slots.map((item, slotIndex) => (slotIndex === index ? { ...item, look: !item.look } : item))
}

/** The master chain, in slot order, skipping empty and bypassed inserts. */
export function activeInserts(slots: readonly InsertSlot[]): InsertSlot[] {
  return slots.filter((slot) => slot.path != null && !slot.bypass).slice(0, INSERT_COUNT)
}
