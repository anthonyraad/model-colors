import { describe, expect, it } from 'vitest'
import { APPEARANCE_KEY, rememberedAppearance } from './appearance'

describe('appearance memory', () => {
  it('opens in light mode until the user has chosen dark', () => {
    expect(rememberedAppearance(null)).toBe('light')
    expect(rememberedAppearance('')).toBe('light')
    expect(rememberedAppearance('light')).toBe('light')
    expect(rememberedAppearance('dark')).toBe('dark')
    expect(APPEARANCE_KEY).toBe('cycles-appearance')
  })
})
