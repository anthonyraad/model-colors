export type Schedule = (fn: () => void, ms: number) => { cancel: () => void }

export function timeoutSchedule(fn: () => void, ms: number): { cancel: () => void } {
  const handle = setTimeout(fn, ms)
  return { cancel: () => clearTimeout(handle) }
}

export function createCoalescer(options: {
  intervalMs: number
  now: () => number
  send: (key: string, messages: number[][]) => void
  schedule?: Schedule
}) {
  const schedule = options.schedule ?? timeoutSchedule
  const pending = new Map<string, { messages: number[][]; started: number }>()
  let timer: { cancel: () => void } | null = null

  function flushKey(key: string): void {
    const item = pending.get(key)
    if (!item) return
    pending.delete(key)
    options.send(key, item.messages)
  }

  function arm(): void {
    if (timer || pending.size === 0) return
    let oldest = Infinity
    for (const item of pending.values()) oldest = Math.min(oldest, item.started)
    const wait = Math.max(0, options.intervalMs - (options.now() - oldest))
    timer = schedule(() => {
      timer = null
      const due = options.now()
      for (const [key, item] of [...pending]) {
        if (due - item.started >= options.intervalMs) flushKey(key)
      }
      arm()
    }, wait)
  }

  return {
    push(key: string, messages: number[][]): void {
      const existing = pending.get(key)
      if (existing) existing.messages = messages
      else pending.set(key, { messages, started: options.now() })
      arm()
    },
    flush(key?: string): void {
      if (key) {
        flushKey(key)
        return
      }
      timer?.cancel()
      timer = null
      for (const pendingKey of [...pending.keys()]) flushKey(pendingKey)
    },
    drop(key: string): void {
      pending.delete(key)
      if (pending.size === 0) {
        timer?.cancel()
        timer = null
      }
    },
    discard(): void {
      timer?.cancel()
      timer = null
      pending.clear()
    },
    pendingCount(): number {
      return pending.size
    }
  }
}
