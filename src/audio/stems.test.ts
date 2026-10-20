import { describe, expect, it } from 'vitest'
import { mixStemFrame, stemChannelCount, stemEnergy, stemMixGain, stemPeaks, stemStrike, timeDomainPeak } from './stems'

describe('six-track stems', () => {
  it('keeps a stereo device as a stereo mix and a six-channel device as six tracks', () => {
    expect(stemChannelCount(2)).toBe(2)
    expect(stemChannelCount(1)).toBe(2)
    expect(stemChannelCount(6)).toBe(6)
    expect(stemChannelCount(8)).toBe(6)
  })

  it('passes stereo through and sums six stems onto both speakers', () => {
    expect(mixStemFrame([0.4, -0.2], 2)).toEqual([0.4, -0.2])
    expect(stemMixGain(6)).toBe(1)
    const mixed = mixStemFrame([1, 0, 0, 0, 0, 0], 6)
    expect(mixed[0]).toBeCloseTo(1)
    expect(mixed[1]).toBeCloseTo(1)
    const all = mixStemFrame([0.2, 0.2, 0.2, 0.2, 0.2, 0.2], 6)
    expect(all[0]).toBeCloseTo(1.2)
  })

  it('reads each track from its own channel', () => {
    expect(stemPeaks([0.2, 0.9], 2)).toBeNull()
    const peaks = stemPeaks([0.1, 0, 0, 0, 0, 0.4, 0.5, 0.2, 0, 0, 0, 0], 6)
    expect(peaks).toEqual([0.5, 0.2, 0, 0, 0, 0.4])
  })

  it('turns a stem peak into orb energy and leaves silence dark', () => {
    expect(stemEnergy(0)).toBe(0)
    expect(stemEnergy(0.005)).toBe(0)
    expect(stemEnergy(0.25)).toBeGreaterThan(0.6)
    expect(stemEnergy(1)).toBe(1)
    expect(stemStrike(0.2, 0.21)).toBe(0)
    expect(stemStrike(0.1, 0.4)).toBeGreaterThan(0.8)
    expect(stemStrike(0.8, 0.7)).toBe(0)
    const time = new Uint8Array(8).fill(128)
    expect(timeDomainPeak(time)).toBe(0)
    time[3] = 200
    expect(timeDomainPeak(time)).toBeCloseTo(72 / 128)
  })
})
