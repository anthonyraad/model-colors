import { parentPort, type MessagePort } from 'node:worker_threads'
import { createRequire } from 'node:module'

type MidiInput = {
  getPortCount(): number
  getPortName(index: number): string
  ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void
  openPort(index: number): void
  closePort(): void
  on(event: 'message', callback: (deltaTime: number, message: number[] | Buffer) => void): void
}

type MidiOutput = {
  getPortCount(): number
  getPortName(index: number): string
  openPort(index: number): void
  closePort(): void
  sendMessage(message: number[]): void
}

type MidiModule = {
  Input: new () => MidiInput
  Output: new () => MidiOutput
}

type Request = {
  id: number
  cmd: 'list' | 'open' | 'close' | 'send'
  inputId?: string | null
  outputId?: string | null
  bytes?: number[]
}

const channel: MessagePort = parentPort ?? (() => {
  throw new Error('The MIDI worker has no parent port.')
})()

let midi: MidiModule | null = null
let loadError: string | null = null
let input: MidiInput | null = null
let output: MidiOutput | null = null

try {
  const require = createRequire(import.meta.url)
  midi = require('@julusian/midi') as MidiModule
} catch (error) {
  loadError = error instanceof Error ? error.message : 'The MIDI library failed to load.'
}

channel.on('message', (request: Request) => {
  try {
    if (request.cmd === 'list') {
      channel.postMessage({ id: request.id, ok: true, ...listPorts() })
      return
    }
    if (request.cmd === 'open') {
      openPorts(request.inputId ?? null, request.outputId ?? null)
      channel.postMessage({ id: request.id, ok: true })
      return
    }
    if (request.cmd === 'close') {
      closePorts()
      channel.postMessage({ id: request.id, ok: true })
      return
    }
    if (request.cmd === 'send') {
      if (!output) throw new Error('No hardware output is open.')
      output.sendMessage(request.bytes ?? [])
      channel.postMessage({ id: request.id, ok: true })
    }
  } catch (error) {
    channel.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'MIDI failed.'
    })
  }
})

function listPorts() {
  if (!midi) return { inputs: [], outputs: [], error: loadError }
  try {
    return {
      inputs: collect(() => new midi!.Input(), 'in'),
      outputs: collect(() => new midi!.Output(), 'out'),
      error: null
    }
  } catch (error) {
    return {
      inputs: [],
      outputs: [],
      error: error instanceof Error ? error.message : 'MIDI ports could not be listed.'
    }
  }
}

function openPorts(inputId: string | null, outputId: string | null) {
  closePorts()
  if (!inputId && !outputId) return
  if (!midi) throw new Error(loadError ?? 'Hardware MIDI is unavailable. The simulator still works.')
  if (inputId) {
    const ports = collect(() => new midi.Input(), 'in')
    const match = ports.find((item) => item.id === inputId)
    if (!match) throw new Error('That input disappeared. Refresh and choose it again.')
    const opened = new midi.Input()
    opened.ignoreTypes(false, false, true)
    opened.openPort(match.index)
    opened.on('message', (_delta, message) => {
      channel.postMessage({ cmd: 'midi', bytes: Array.from(message) })
    })
    input = opened
  }
  if (outputId) {
    const ports = collect(() => new midi.Output(), 'out')
    const match = ports.find((item) => item.id === outputId)
    if (!match) throw new Error('That output disappeared. Refresh and choose it again.')
    const opened = new midi.Output()
    opened.openPort(match.index)
    output = opened
  }
}

function closePorts() {
  try {
    input?.closePort()
  } catch {
    /* already closed */
  }
  try {
    output?.closePort()
  } catch {
    /* already closed */
  }
  input = null
  output = null
}

function collect(
  open: () => { getPortCount(): number; getPortName(index: number): string; closePort(): void },
  prefix: string
) {
  const listing = open()
  try {
    const seen = new Map<string, number>()
    const ports: { id: string; name: string; index: number }[] = []
    const count = listing.getPortCount()
    for (let index = 0; index < count; index += 1) {
      const name = listing.getPortName(index).trim()
      const tally = (seen.get(name) ?? 0) + 1
      seen.set(name, tally)
      const id = tally === 1 ? `${prefix}:${name}` : `${prefix}:${name}#${tally}`
      ports.push({ id, name, index })
    }
    return ports
  } finally {
    try {
      listing.closePort()
    } catch {
      /* Enumeration does not require the port to be open. */
    }
  }
}
