/** Channel 1 is track 1. A stereo device is the stock mix and has no stems. */
export function stemChannelCount(deviceChannels: number): number {
  return deviceChannels >= 6 ? 6 : 2
}

/** Each stem is added at the level the Model:Cycles recorded it. A loud stack is softened later, at the speakers. */
export function stemMixGain(_channels: number): number {
  return 1
}

/** Six mono stems, taken before pan, become one stereo pair. The first two channels of a stereo device pass through. */
export function mixStemFrame(samples: readonly number[], channels: number): [number, number] {
  if (channels <= 1) {
    const mono = samples[0] ?? 0
    return [mono, mono]
  }
  if (channels === 2) return [samples[0] ?? 0, samples[1] ?? 0]
  const stems = Math.min(6, channels)
  const gain = stemMixGain(stems)
  let sum = 0
  for (let index = 0; index < stems; index += 1) sum += samples[index] ?? 0
  const mixed = sum * gain
  return [mixed, mixed]
}

/** Peak of each track in one interleaved block. Stereo returns nothing, because those two channels are not tracks. */
export function stemPeaks(interleaved: readonly number[], channels: number): number[] | null {
  if (channels < 6 || interleaved.length < channels) return null
  const peaks = [0, 0, 0, 0, 0, 0]
  const frames = Math.floor(interleaved.length / channels)
  for (let frame = 0; frame < frames; frame += 1) {
    const at = frame * channels
    for (let channel = 0; channel < 6; channel += 1) {
      const level = Math.abs(interleaved[at + channel] ?? 0)
      if (level > peaks[channel]) peaks[channel] = level
    }
  }
  return peaks
}

/** A stem peak in the same 0–1 range the orbs use for a hit. Silence stays at 0. */
export function stemEnergy(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0.008) return 0
  return Math.min(1, ((peak - 0.008) / 0.22) ** 0.5)
}

/** How hard a track just attacked. A note that is already ringing does not shove again. */
export function stemStrike(previous: number, level: number): number {
  const jump = level - previous
  if (!Number.isFinite(jump) || jump < 0.018) return 0
  return Math.min(1, (jump - 0.018) / 0.09)
}

/** Peak of one analyser time-domain buffer. 128 is silence. */
export function timeDomainPeak(time: Uint8Array): number {
  let peak = 0
  for (let index = 0; index < time.length; index += 1) {
    const sample = Math.abs(((time[index] ?? 128) - 128) / 128)
    if (sample > peak) peak = sample
  }
  return peak
}
