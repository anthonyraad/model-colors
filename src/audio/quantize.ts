/**
 * Duck and stutter quantize to the nearest downbeat 8th (1, 3, 5, 7).
 * Those fall on the quarter-note beats. An off 8th is exactly halfway, so it waits for the next downbeat.
 */
export const QUANTIZE_DOWNBEAT_BEATS = 1

/**
 * How long to wait, in quarter-note beats, before a duck or stutter change.
 * The first half of a step belongs to the grid line just passed, so the change
 * happens now. The second half waits for the next line.
 */
export function quantizeDelay(beats: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(beats)) return 0
  const into = ((beats % step) + step) % step
  if (into < step / 2) return 0
  return step - into
}

/**
 * How long to wait, in quarter-note beats, until the current bar ends.
 * A press anywhere inside the bar waits for the next line. A press already
 * on that line happens now.
 */
export function quantizeBarEnd(beats: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(beats)) return 0
  const into = ((beats % step) + step) % step
  if (into === 0) return 0
  return step - into
}

