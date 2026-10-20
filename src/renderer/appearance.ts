/** First launch is light. Only an explicit dark choice is remembered. */
export function rememberedAppearance(stored: string | null): 'dark' | 'light' {
  return stored === 'dark' ? 'dark' : 'light'
}

export const APPEARANCE_KEY = 'cycles-appearance'
