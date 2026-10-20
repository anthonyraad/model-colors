import { parameterByCc } from './protocol'
import { patternLabel } from './routing'

/** Non-commercial manufacturer ID. Not an Elektron frame, so a Model:Cycles should ignore it. */
export const LOOPBACK_PROBE = [0xf0, 0x7d, 0x4d, 0x43, 0x01, 0xf7]

export function isLoopbackProbe(bytes: number[]): boolean {
  return bytes.length === LOOPBACK_PROBE.length && bytes.every((byte, index) => byte === LOOPBACK_PROBE[index])
}

export function describeMessage(bytes: number[]): string {
  if (bytes.length === 0) return 'Empty'
  if (bytes.length === 1 && bytes[0] === 0xfc) return 'Stop'
  if (bytes.length === 1 && bytes[0] === 0xfa) return 'Start'
  if (bytes.length === 1 && bytes[0] === 0xf8) return 'Clock'
  if (bytes[0] === 0xf0) {
    if (isLoopbackProbe(bytes)) return 'Loopback probe (not an Elektron message)'
    return `SysEx, ${bytes.length} bytes`
  }
  const kind = bytes[0] & 0xf0
  const channel = (bytes[0] & 0x0f) + 1
  if (kind === 0xb0 && bytes.length >= 3) {
    if (bytes[1] === 123) return `All notes off, channel ${channel}`
    const parameter = parameterByCc(bytes[1])
    const name = parameter
      ? parameter.lsb === bytes[1]
        ? `${parameter.name} fine`
        : parameter.name
      : `CC ${bytes[1]}`
    return `${name}, channel ${channel}, value ${bytes[2]}`
  }
  if (kind === 0x90 && bytes.length >= 3) {
    return bytes[2] === 0
      ? `Note off, channel ${channel}, note ${bytes[1]}`
      : `Note on, channel ${channel}, note ${bytes[1]}, velocity ${bytes[2]}`
  }
  if (kind === 0x80 && bytes.length >= 2) return `Note off, channel ${channel}, note ${bytes[1]}`
  if (kind === 0xc0 && bytes.length >= 2) {
    const program = bytes[1] ?? 0
    const name = program <= 95 ? patternLabel(program) : `program ${program}`
    return `Program ${name}, channel ${channel}`
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
}
