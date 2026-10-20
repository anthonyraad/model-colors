import { isLoopbackProbe } from './describe'

export type SimOptions = {
  /** When set, received parameter CCs are returned so the app can mark them observed. */
  echoParameters: boolean
}

/**
 * In-process stand-in for the documented MIDI subset.
 * It stores CCs and notes. It does not accept a pattern dump.
 */
export class SimulatedCycles {
  readonly cc = new Map<string, number>()
  readonly notes = new Set<string>()
  stopped = false
  echoParameters: boolean

  constructor(options: SimOptions = { echoParameters: true }) {
    this.echoParameters = options.echoParameters
  }

  handle(bytes: number[]): number[][] {
    if (isLoopbackProbe(bytes)) return [[...bytes]]
    if (bytes.length === 1 && bytes[0] === 0xfc) {
      this.stopped = true
      this.notes.clear()
      return []
    }
    if (bytes.length < 3) return []
    const kind = bytes[0] & 0xf0
    const channel = bytes[0] & 0x0f
    if (kind === 0xb0) {
      this.cc.set(`${channel}:${bytes[1]}`, bytes[2])
      if (bytes[1] === 123) {
        for (const note of [...this.notes]) {
          if (note.startsWith(`${channel}:`)) this.notes.delete(note)
        }
      }
      if (this.echoParameters && bytes[1] !== 123) return [[...bytes]]
      return []
    }
    if (kind === 0x90) {
      const key = `${channel}:${bytes[1]}`
      if (bytes[2] === 0) this.notes.delete(key)
      else this.notes.add(key)
      return []
    }
    if (kind === 0x80) {
      this.notes.delete(`${channel}:${bytes[1]}`)
      return []
    }
    return []
  }
}
