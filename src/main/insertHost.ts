import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { app } from 'electron'
import { join } from 'node:path'
import type { AudioEndpoint, InsertPlugin, InsertSlot } from '../audio/inserts'
import { catchFilter, FILTER_RESONANCE, projectFilter, type FilterCatch, type FilterMove, type FilterResonanceId, type FilterSlopeDb } from '../audio/outputFilter'
import { type DuckCommand } from '../audio/duck'
import { type StutterCommand } from '../audio/stutter'
import { type MotionState } from '../audio/motion'
import type { InsertCatalog, InsertResult, RecordingStop } from '../midi/bridge'

type Reply = {
  ok: boolean
  kind: string
  message?: string
  plugins?: InsertPlugin[]
  inputs?: AudioEndpoint[]
  outputs?: AudioEndpoint[]
  states?: (string | null)[]
  seconds?: number
  levels?: number[]
  wave?: number[]
}

let stemListener: ((levels: number[], wave?: number[]) => void) | null = null

export function setStemListener(listener: (levels: number[], wave?: number[]) => void): void {
  stemListener = listener
}

let child: ChildProcessWithoutNullStreams | null = null
let ready: Promise<void> | null = null
let catchUp: FilterCatch | null = null
let rememberedDuck: DuckCommand = { division: 0, bpm: 120, beats: 0, running: false, seek: false, custom: false, trigs: 0 }
let duckLatest: DuckCommand | null = null
let duckTicket = 0
let duckChain: Promise<void> = Promise.resolve()
let rememberedStutter: StutterCommand = { division: 0, bpm: 120, beats: 0, running: false, seek: false, custom: false, trigs: 0 }
let stutterLatest: StutterCommand | null = null
let stutterTicket = 0
let stutterChain: Promise<void> = Promise.resolve()
let rememberedMotion: MotionState & { bpm: number; beats: number; over: boolean; tapeBeats: number; tapeOver: boolean } = {
  reverse: false,
  tape: false,
  bpm: 120,
  beats: 16,
  over: false,
  tapeBeats: 2,
  tapeOver: false
}
let motionLatest: (MotionState & { bpm: number; beats: number; over: boolean; tapeBeats: number; tapeOver: boolean }) | null = null
let motionTicket = 0
let motionChain: Promise<void> = Promise.resolve()
let rememberedShape: { slope: FilterSlopeDb; resonance: FilterResonanceId } = { slope: 12, resonance: 'none' }
const waiters: Array<(line: string) => void> = []
let chain: Promise<unknown> = Promise.resolve()

function exePath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'insert-host', 'CyclesInsertHost.exe')
  return join(process.cwd(), 'host', 'publish', 'CyclesInsertHost.exe')
}

function ensure(): Promise<void> {
  if (child && child.exitCode == null && ready) return ready
  const exe = exePath()
  if (!existsSync(exe)) return Promise.reject(new Error('The insert host is missing from this build.'))
  const proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  child = proc
  let stderr = ''
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000)
  })
  const lines = createInterface({ input: proc.stdout })
  lines.on('line', (line) => {
    try {
      const pushed = JSON.parse(line) as Reply
      if (pushed.kind === 'stems' && Array.isArray(pushed.levels)) {
        stemListener?.(pushed.levels, pushed.wave)
        return
      }
    } catch {
      /* a command reply still belongs to the waiter below */
    }
    const waiter = waiters.shift()
    waiter?.(line)
  })
  proc.on('exit', () => {
    const message = stderr.trim() || 'The insert host stopped.'
    while (waiters.length > 0) waiters.shift()?.(JSON.stringify({ ok: false, kind: 'error', message }))
    if (child === proc) {
      child = null
      ready = null
    }
  })
  ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The insert host did not start.')), 15000)
    waiters.push((line) => {
      clearTimeout(timer)
      try {
        const reply = JSON.parse(line) as Reply
        if (reply.ok) resolve()
        else reject(new Error(reply.message ?? 'The insert host did not start.'))
      } catch {
        reject(new Error('The insert host sent an unreadable reply.'))
      }
    })
  })
  return ready
}

function request(payload: object, timeoutMs = 20000): Promise<Reply> {
  const run = chain.then(async () => {
    await ensure()
    return await new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The insert host took too long to answer.')), timeoutMs)
      waiters.push((line) => {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(line) as Reply)
        } catch {
          reject(new Error('The insert host sent an unreadable reply.'))
        }
      })
      child?.stdin.write(`${JSON.stringify(payload)}\n`)
    })
  })
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export async function listAudioDevices(): Promise<{ ok: true; inputs: AudioEndpoint[]; outputs: AudioEndpoint[] } | { ok: false; message: string }> {
  try {
    const devices = await request({ cmd: 'devices' })
    if (!devices.ok) return { ok: false, message: devices.message ?? 'Could not list audio devices.' }
    return { ok: true, inputs: devices.inputs ?? [], outputs: devices.outputs ?? [] }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not list audio devices.' }
  }
}

export async function listInserts(): Promise<InsertCatalog> {
  try {
    const plugins = await request({ cmd: 'plugins' }, 60000)
    const devices = await request({ cmd: 'devices' })
    if (!plugins.ok || !devices.ok) {
      return { ok: false, message: plugins.message ?? devices.message ?? 'Could not list inserts.' }
    }
    return {
      ok: true,
      plugins: plugins.plugins ?? [],
      inputs: devices.inputs ?? [],
      outputs: devices.outputs ?? []
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not list inserts.' }
  }
}

export async function startInserts(
  inputId: string | null,
  outputId: string | null,
  slots: InsertSlot[],
  tempo: number
): Promise<InsertResult> {
  try {
    const snapshot = catchUp
    const pending = snapshot ? projectFilter(snapshot, Date.now()) : null
    const reply = await request(
      {
        cmd: 'start',
        inputId,
        outputId,
        tempo,
        slots: slots.map((slot) => ({ path: slot.path, bypass: slot.bypass, fadeBars: slot.fadeBars, fadeOutBars: slot.fadeOutBars })),
        ...(pending
          ? {
              filter: pending.move,
              position: pending.position,
              ...(pending.move === 'return' ? { wait: pending.returnWait, span: pending.returnSpan } : {})
            }
          : {}),
        duck: rememberedDuck.division,
        duckBpm: rememberedDuck.bpm,
        duckBeats: rememberedDuck.beats,
        duckRunning: rememberedDuck.running,
        duckSeek: rememberedDuck.seek,
        duckCustom: rememberedDuck.custom,
        duckTrigs: rememberedDuck.trigs,
        filterSlope: rememberedShape.slope,
        filterQ: FILTER_RESONANCE.find((item) => item.id === rememberedShape.resonance)?.q ?? FILTER_RESONANCE[0].q,
        stutter: rememberedStutter.division,
        stutterBpm: rememberedStutter.bpm,
        stutterBeats: rememberedStutter.beats,
        stutterRunning: rememberedStutter.running,
        stutterSeek: rememberedStutter.seek,
        stutterCustom: rememberedStutter.custom,
        stutterTrigs: rememberedStutter.trigs,
        motionReverse: rememberedMotion.reverse,
        motionTape: rememberedMotion.tape,
        motionBpm: rememberedMotion.bpm,
        motionBeats: rememberedMotion.beats,
        motionOver: rememberedMotion.over,
        motionTapeBeats: rememberedMotion.tapeBeats,
        motionTapeOver: rememberedMotion.tapeOver
      },
      60000
    )
    if (!reply.ok) return { ok: false, message: reply.message ?? 'Could not start the inserts.' }
    if (catchUp === snapshot) catchUp = null
    else if (catchUp) {
      const newer = projectFilter(catchUp, Date.now())
      catchUp = null
      const follow = await request({ cmd: 'filter', move: newer.move, position: newer.position }, 5000)
      if (!follow.ok) {
        catchUp ??= newer
        return { ok: false, message: follow.message ?? 'Could not set the filter.' }
      }
    }
    return { ok: true, message: reply.message ?? 'Inserts are on.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not start the inserts.' }
  }
}

export async function stopInserts(): Promise<InsertResult> {
  try {
    const reply = await request({ cmd: 'stop' })
    return { ok: reply.ok, message: reply.message ?? 'Inserts are off.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not stop the inserts.' }
  }
}

function hostUp(): boolean {
  return child != null && child.exitCode == null
}

export async function readInsertStates(): Promise<{ ok: true; states: (string | null)[] } | { ok: false; message: string }> {
  if (!hostUp()) return { ok: true, states: [] }
  try {
    const reply = await request({ cmd: 'states' }, 20000)
    if (!reply.ok) return { ok: false, message: reply.message ?? 'Could not read the plug-in settings.' }
    return { ok: true, states: reply.states ?? [] }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not read the plug-in settings.' }
  }
}

export async function writeInsertStates(states: (string | null)[]): Promise<InsertResult> {
  if (!hostUp() || states.length === 0) return { ok: true, message: 'Plug-in settings restored.' }
  try {
    const reply = await request({ cmd: 'restore', states }, 20000)
    if (!reply.ok) return { ok: false, message: reply.message ?? 'Could not restore the plug-in settings.' }
    return { ok: true, message: reply.message ?? 'Plug-in settings restored.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not restore the plug-in settings.' }
  }
}

export function setOutputFilter(
  move: FilterMove,
  reset?: { position: number; wait: number; span: number }
): Promise<InsertResult> {
  const now = Date.now()
  if (move === 'return' && reset && Number.isFinite(reset.position)) {
    const scheduled: FilterCatch = {
      move: 'return',
      position: reset.position,
      at: now,
      returnFrom: reset.position,
      returnWait: Math.max(0, reset.wait),
      returnSpan: Math.max(0, reset.span)
    }
    if (!hostUp()) {
      catchUp = scheduled
      return Promise.resolve({ ok: true, message: 'The filter applies while inserts are playing.' })
    }
    catchUp = null
    return deliverFilter('return', scheduled.position, scheduled.returnWait, scheduled.returnSpan)
  }
  if (!hostUp()) {
    catchUp = catchFilter(catchUp, move, now)
    return Promise.resolve({ ok: true, message: 'The filter applies while inserts are playing.' })
  }
  if (catchUp) {
    const pending = catchFilter(catchUp, move, now)
    catchUp = null
    return deliverFilter(pending.move, pending.position, pending.returnWait, pending.returnSpan)
  }
  return deliverFilter(move)
}

export function setOutputFilterShape(slope: FilterSlopeDb, resonance: FilterResonanceId): Promise<InsertResult> {
  const known: FilterSlopeDb = slope === 24 ? 24 : 12
  const chosen = FILTER_RESONANCE.find((item) => item.id === resonance) ?? FILTER_RESONANCE[0]
  rememberedShape = { slope: known, resonance: chosen.id }
  if (!hostUp()) return Promise.resolve({ ok: true, message: 'The filter applies while inserts are playing.' })
  return request({ cmd: 'filter-shape', slope: known, q: chosen.q }, 5000).then((reply) => {
    if (!reply.ok) return { ok: false as const, message: reply.message ?? 'Could not set the filter.' }
    return { ok: true as const, message: 'Filter updated.' }
  })
}

function deliverFilter(move: FilterMove, position?: number, wait?: number, span?: number): Promise<InsertResult> {
  const payload: { cmd: 'filter'; move: FilterMove; position?: number; wait?: number; span?: number } = { cmd: 'filter', move }
  if (position != null && Number.isFinite(position)) payload.position = position
  if (move === 'return' && wait != null && span != null) {
    payload.wait = wait
    payload.span = span
  }
  return request(payload, 5000).then((reply) => {
    if (!reply.ok) return { ok: false as const, message: reply.message ?? 'Could not set the filter.' }
    return { ok: true as const, message: 'Filter updated.' }
  })
}

export function setOutputDuck(command: DuckCommand): Promise<InsertResult> {
  rememberedDuck = command
  if (!hostUp()) return Promise.resolve({ ok: true, message: 'The ducker applies while inserts are playing.' })
  duckLatest = command
  const ticket = ++duckTicket
  const run = duckChain.then(async () => {
    if (ticket !== duckTicket || !duckLatest) return { ok: true as const, message: 'Duck updated.' }
    const next = duckLatest
    try {
      const reply = await request(
        { cmd: 'duck', division: next.division, bpm: next.bpm, beats: next.beats, running: next.running, seek: next.seek, custom: next.custom, trigs: next.trigs },
        5000
      )
      if (!reply.ok) return { ok: false as const, message: reply.message ?? 'Could not set the ducker.' }
      return { ok: true as const, message: 'Duck updated.' }
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : 'Could not set the ducker.' }
    }
  })
  duckChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export function setOutputStutter(command: StutterCommand): Promise<InsertResult> {
  rememberedStutter = command
  if (!hostUp()) return Promise.resolve({ ok: true, message: 'The stutter applies while inserts are playing.' })
  stutterLatest = command
  const ticket = ++stutterTicket
  const run = stutterChain.then(async () => {
    if (ticket !== stutterTicket || !stutterLatest) return { ok: true as const, message: 'Stutter updated.' }
    const next = stutterLatest
    try {
      const reply = await request(
        { cmd: 'stutter', division: next.division, bpm: next.bpm, beats: next.beats, running: next.running, seek: next.seek, custom: next.custom, trigs: next.trigs },
        5000
      )
      if (!reply.ok) return { ok: false as const, message: reply.message ?? 'Could not set the stutter.' }
      return { ok: true as const, message: 'Stutter updated.' }
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : 'Could not set the stutter.' }
    }
  })
  stutterChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export function setOutputMotion(state: MotionState, bpm: number, beats: number, over: boolean, tapeBeats: number, tapeOver: boolean): Promise<InsertResult> {
  const tempo = bpm >= 20 && bpm <= 400 ? bpm : 120
  const length = beats === 4 || beats === 8 || beats === 16 || beats === 32 ? beats : 16
  const wind = tapeBeats === 1 || tapeBeats === 2 || tapeBeats === 4 ? tapeBeats : 2
  rememberedMotion = { reverse: state.reverse, tape: state.tape, bpm: tempo, beats: length, over, tapeBeats: wind, tapeOver }
  if (!hostUp()) return Promise.resolve({ ok: true, message: 'The effect applies while inserts are playing.' })
  motionLatest = rememberedMotion
  const ticket = ++motionTicket
  const run = motionChain.then(async () => {
    if (ticket !== motionTicket || !motionLatest) return { ok: true as const, message: 'Motion updated.' }
    const next = motionLatest
    try {
      const reply = await request({ cmd: 'motion', reverse: next.reverse, tape: next.tape, bpm: next.bpm, beats: next.beats, over: next.over, tapeBeats: next.tapeBeats, tapeOver: next.tapeOver }, 5000)
      if (!reply.ok) return { ok: false as const, message: reply.message ?? 'Could not set the effect.' }
      return { ok: true as const, message: 'Motion updated.' }
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : 'Could not set the effect.' }
    }
  })
  motionChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export async function openInsertEditor(path: string, inputId: string | null): Promise<InsertResult> {
  try {
    const reply = await request({ cmd: 'editor', path, inputId }, 20000)
    return { ok: reply.ok, message: reply.message ?? (reply.ok ? 'Opened the plug-in window.' : 'Could not open the plug-in window.') }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not open the plug-in window.' }
  }
}

export async function startRecording(): Promise<InsertResult> {
  if (!hostUp()) return { ok: false, message: 'Play through the inserts before recording.' }
  try {
    const reply = await request({ cmd: 'record-start' })
    return { ok: reply.ok, message: reply.message ?? (reply.ok ? 'Recording.' : 'Could not start recording.') }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not start recording.' }
  }
}

export async function stopRecording(): Promise<RecordingStop> {
  if (!hostUp()) return { ok: false, message: 'Nothing was captured. Play through the inserts, then record.' }
  try {
    const reply = await request({ cmd: 'record-stop' })
    if (!reply.ok || !(typeof reply.seconds === 'number') || reply.seconds <= 0) {
      return { ok: false, message: reply.message ?? 'Nothing was captured. Play through the inserts, then record.' }
    }
    return { ok: true, seconds: reply.seconds }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not stop the recording.' }
  }
}

export async function saveRecording(filePath: string): Promise<InsertResult> {
  if (!hostUp()) return { ok: false, message: 'The recording is no longer available.' }
  try {
    const reply = await request({ cmd: 'record-save', path: filePath })
    return { ok: reply.ok, message: reply.message ?? (reply.ok ? 'Saved the recording.' : 'Could not save the recording.') }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not save the recording.' }
  }
}

export async function discardRecording(): Promise<InsertResult> {
  if (!hostUp()) return { ok: true, message: 'Recording discarded.' }
  try {
    const reply = await request({ cmd: 'record-discard' })
    return { ok: reply.ok, message: reply.message ?? 'Recording discarded.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not discard the recording.' }
  }
}

export function stopInsertHost(): void {
  const proc = child
  if (!proc || proc.exitCode != null) return
  try {
    proc.stdin.write(`${JSON.stringify({ cmd: 'quit' })}\n`)
  } catch {
    proc.kill()
  }
  setTimeout(() => {
    if (proc.exitCode == null) proc.kill()
  }, 1500)
}
