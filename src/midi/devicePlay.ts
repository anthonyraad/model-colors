/** 24 MIDI clocks per quarter note, the rate a sequencer play button follows. */
export const CLOCKS_PER_QUARTER = 24

/** Milliseconds between MIDI clocks at this tempo. Out-of-range tempos use 120. */
export function clockGapMs(bpm: number): number {
  const tempo = bpm >= 40 && bpm <= 240 ? bpm : 120
  return 60000 / tempo / CLOCKS_PER_QUARTER
}
