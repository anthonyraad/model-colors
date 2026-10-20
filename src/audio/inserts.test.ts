import { describe, expect, it } from 'vitest'
import { INSERT_KEYS, INSERT_LOOKS, INSERT_LOOK_SHORT, activeInserts, assignSlot, clearSlot, emptySlots, moveSlotTo, setFadeBars, setFadeOutBars, toggleBypass, togglePosition } from './inserts'

describe('master inserts', () => {
  it('keeps six slots and runs only the loaded ones that are not bypassed', () => {
    const slots = emptySlots()
    expect(slots).toHaveLength(6)
    expect(slots.every((slot) => slot.fadeBars === 0 && slot.fadeOutBars === 0 && slot.look === false)).toBe(true)
    expect(INSERT_LOOKS).toEqual(['Braid', 'Bloom', 'Split', 'Scratch', 'Sweep', 'Drown'])
    expect(INSERT_LOOK_SHORT).toEqual(['Braid', 'Bloom', 'Split', 'Scratch', 'Sweep', 'Drown'])
    const withKick = assignSlot(slots, 0, { name: 'Compressor', path: 'C:\\VST3\\Comp.vst3', vendor: 'Room' })
    const withHat = assignSlot(withKick, 2, { name: 'EQ', path: 'C:\\VST3\\Eq.vst3', vendor: 'Room' })
    expect(activeInserts(withHat).map((slot) => slot.name)).toEqual(['Compressor', 'EQ'])
    const bypassed = toggleBypass(withHat, 0)
    expect(activeInserts(bypassed).map((slot) => slot.name)).toEqual(['EQ'])
    expect(activeInserts(clearSlot(bypassed, 2))).toEqual([])
    expect(INSERT_KEYS).toEqual(['q', 'w', 'e', 'r', 't', 'y'])
    const faded = setFadeBars(withHat, 2, 4)
    const released = setFadeOutBars(faded, 2, 2)
    expect(released[2].fadeBars).toBe(4)
    expect(released[2].fadeOutBars).toBe(2)
    expect(toggleBypass(released, 2)[2].fadeOutBars).toBe(2)
    expect(assignSlot(released, 2, { name: 'Delay', path: 'C:\\VST3\\Delay.vst3', vendor: 'Room' })[2].fadeOutBars).toBe(2)
    expect(clearSlot(released, 2)[2].fadeOutBars).toBe(2)
    expect(assignSlot(slots, 1, { name: 'EQ', path: 'C:\\VST3\\Eq.vst3', vendor: 'Room' })[1].look).toBe(true)
    expect(toggleBypass(assignSlot(slots, 0, { name: 'Compressor', path: 'C:\\VST3\\Comp.vst3', vendor: 'Room' }), 0)[0].look).toBe(false)
    const grain = togglePosition(slots, 0)
    expect(grain[0].look).toBe(true)
    expect(grain[0].bypass).toBe(false)
    expect(togglePosition(grain, 0)[0].look).toBe(false)
    expect(clearSlot(assignSlot(slots, 3, { name: 'EQ', path: 'C:\\VST3\\Eq.vst3', vendor: 'Room' }), 3)[3].look).toBe(false)
  })

  it('drags a loaded insert to a new place in the chain and leaves an empty slot alone', () => {
    const comp = { name: 'Compressor', path: 'C:\\VST3\\Comp.vst3', vendor: 'Room' }
    const eq = { name: 'EQ', path: 'C:\\VST3\\Eq.vst3', vendor: 'Room' }
    const loaded = assignSlot(assignSlot(emptySlots(), 0, comp), 2, eq)
    expect(moveSlotTo(loaded, 2, 0).map((slot) => slot.name)).toEqual(['EQ', 'Compressor', null, null, null, null])
    expect(moveSlotTo(loaded, 0, 2).map((slot) => slot.name)).toEqual([null, 'EQ', 'Compressor', null, null, null])
    expect(moveSlotTo(loaded, 1, 0).map((slot) => slot.name)).toEqual(['Compressor', null, 'EQ', null, null, null])
    expect(activeInserts(moveSlotTo(loaded, 2, 0)).map((slot) => slot.name)).toEqual(['EQ', 'Compressor'])
  })
})
