import { describe, expect, it } from 'vitest'
import { buildPreset, emptyAdvanced, parsePresetDocument, removePreset, slotsFromPreset, statesFromPreset, upsertPreset } from './controlsPreset'
import { emptySlots } from './inserts'

describe('controls presets', () => {
  it('keeps six slots and attaches plug-in state only where a plug-in is loaded', () => {
    const slots = emptySlots()
    slots[0] = { path: null, name: null, bypass: false, fadeBars: 0, fadeOutBars: 1, look: true }
    slots[1] = { path: 'C:/verbs/room.vst3', name: 'Room', bypass: false, fadeBars: 2, fadeOutBars: 4, look: true }
    slots[4] = { path: 'C:/verbs/hall.vst3', name: 'Hall', bypass: true, fadeBars: 0, fadeOutBars: 0, look: false }
    const preset = buildPreset({
      name: '  Night  ',
      savedAt: '2026-10-14T00:00:00.000Z',
      inputId: 'in',
      outputId: 'out',
      slots,
      states: ['room-state', 'hall-state'],
      advanced: { ...emptyAdvanced(), reverseBars: 8, tapeSpeed: 'slow', duckTrigs: 3 }
    })
    expect(preset.name).toBe('Night')
    expect(preset.slots).toHaveLength(6)
    expect(preset.slots[1]?.state).toBe('room-state')
    expect(preset.slots[4]?.state).toBe('hall-state')
    expect(preset.slots[0]?.state).toBeNull()
    expect(statesFromPreset(preset)).toEqual(['room-state', 'hall-state'])
    const loaded = slotsFromPreset(preset)
    expect(loaded[0]).toMatchObject({ path: null, bypass: false, look: true })
    expect(loaded[1]).toMatchObject({ name: 'Room', bypass: true, look: false, fadeBars: 2, fadeOutBars: 4 })
    expect(loaded[4]).toMatchObject({ name: 'Hall', bypass: true, look: false })
    expect(preset.advanced.reverseBars).toBe(8)
  })

  it('replaces a preset with the same name and drops unknown files back to defaults', () => {
    const first = buildPreset({
      name: 'Night',
      savedAt: 'a',
      inputId: '',
      outputId: '',
      slots: emptySlots(),
      states: [],
      advanced: emptyAdvanced()
    })
    const second = { ...first, savedAt: 'b', advanced: { ...first.advanced, reverseOver: true } }
    expect(upsertPreset([first], second)).toEqual([second])
    expect(removePreset([first, second], 'night')).toEqual([])
    const parsed = parsePresetDocument({
      version: 1,
      presets: [{ name: 'Day', reverseBars: 99, slots: [{ path: 'x.vst3', fadeBars: 3, state: 'abc' }] }, { name: '  ' }]
    })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.advanced.reverseBars).toBe(4)
    expect(parsed[0]?.advanced.tapeOver).toBe(false)
    const withTape = parsePresetDocument({ presets: [{ name: 'Tape', advanced: { tapeOver: true, reverseOver: true } }] })
    expect(withTape[0]?.advanced.tapeOver).toBe(true)
    expect(withTape[0]?.advanced.reverseOver).toBe(true)
    expect(parsed[0]?.slots[0]).toMatchObject({ path: 'x.vst3', fadeBars: 0, fadeOutBars: 0, state: 'abc' })
    expect(parsed[0]?.slots[1]?.path).toBeNull()
  })
})