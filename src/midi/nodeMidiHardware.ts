import { Worker } from 'node:worker_threads'
import type { HardwarePortList, HardwarePorts } from './session'

type Reply = HardwarePortList & {
  id?: number
  ok?: boolean
  error?: string
  cmd?: string
  bytes?: number[]
}

const PORT_WAIT_MS = 2500

/**
 * Windows MIDI through @julusian/midi. The native calls run on a worker thread.
 * A port that never answers times out here, so the window keeps responding.
 * Clock is received so the visualizer can follow the Model:Cycles. Active sensing is
 * ignored. SysEx is received so a loopback probe can be seen. Nothing is opened until
 * the user connects.
 */
export class NodeMidiHardware implements HardwarePorts {
  private worker: Worker | null = null
  private handler: ((bytes: number[]) => void) | null = null
  private nextId = 0
  private readonly pending = new Map<number, (reply: Reply) => void>()
  private chain: Promise<void> = Promise.resolve()

  onMessage(handler: (bytes: number[]) => void): void {
    this.handler = handler
  }

  list(): Promise<HardwarePortList> {
    return this.call({ cmd: 'list' })
      .then((reply) => ({
        inputs: reply.inputs ?? [],
        outputs: reply.outputs ?? [],
        error: reply.error ?? null
      }))
      .catch((error: unknown) => ({
        inputs: [],
        outputs: [],
        error: error instanceof Error ? error.message : 'MIDI ports could not be listed.'
      }))
  }

  open(inputId: string | null, outputId: string | null): Promise<void> {
    return this.call({ cmd: 'open', inputId, outputId }).then(() => undefined)
  }

  close(): Promise<void> {
    return this.call({ cmd: 'close' }).then(() => undefined)
  }

  send(bytes: number[]): void {
    const worker = this.ensure()
    const id = ++this.nextId
    worker.postMessage({ id, cmd: 'send', bytes })
  }

  private ensure(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./midiWorker.js', import.meta.url))
    worker.on('message', (reply: Reply) => {
      if (reply.cmd === 'midi' && reply.bytes) {
        this.handler?.(reply.bytes)
        return
      }
      if (reply.id == null) return
      const resolve = this.pending.get(reply.id)
      if (!resolve) return
      this.pending.delete(reply.id)
      resolve(reply)
    })
    worker.on('error', (error) => {
      const message = error instanceof Error ? error.message : 'The MIDI worker stopped.'
      for (const resolve of this.pending.values()) resolve({ ok: false, error: message, inputs: [], outputs: [] })
      this.pending.clear()
      this.worker = null
    })
    this.worker = worker
    return worker
  }

  private call(message: { cmd: 'list' | 'open' | 'close'; inputId?: string | null; outputId?: string | null }): Promise<Reply> {
    const run = () =>
      new Promise<Reply>((resolve) => {
        const worker = this.ensure()
        const id = ++this.nextId
        const timer = setTimeout(() => {
          if (!this.pending.delete(id)) return
          resolve({
            ok: false,
            inputs: [],
            outputs: [],
            error: 'The Model:Cycles MIDI port did not answer. Close any other copy of this app, then try again.'
          })
        }, PORT_WAIT_MS)
        this.pending.set(id, (reply) => {
          clearTimeout(timer)
          resolve(reply.ok === false ? { ...reply, inputs: reply.inputs ?? [], outputs: reply.outputs ?? [] } : reply)
        })
        worker.postMessage({ ...message, id })
      })
    const result = this.chain.then(run, run)
    this.chain = result.then(
      () => undefined,
      () => undefined
    )
    return result.then((reply) => {
      if (reply.ok === false && message.cmd !== 'list') throw new Error(reply.error ?? 'Could not open the MIDI port.')
      return reply
    })
  }
}
