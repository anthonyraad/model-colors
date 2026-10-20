import { useEffect, useState, useSyncExternalStore } from 'react'
import { getBridge } from '../midi/client'

export type RecordingPhase = 'idle' | 'recording' | 'review'

export type RecordingSnap = {
  phase: RecordingPhase
  startedAt: number
  seconds: number
  message: string
  busy: boolean
}

let snap: RecordingSnap = { phase: 'idle', startedAt: 0, seconds: 0, message: '', busy: false }
const listeners = new Set<() => void>()

export function recordingSnapshot(): RecordingSnap {
  return snap
}

export function subscribeRecording(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: RecordingSnap): void {
  snap = next
  listeners.forEach((listener) => listener())
}

export async function beginRecording(): Promise<void> {
  if (snap.busy || snap.phase !== 'idle') return
  publish({ ...snap, busy: true, message: '' })
  const result = await getBridge().startRecording()
  if (!result.ok) {
    publish({ phase: 'idle', startedAt: 0, seconds: 0, message: result.message, busy: false })
    return
  }
  publish({ phase: 'recording', startedAt: Date.now(), seconds: 0, message: '', busy: false })
}

export async function endRecording(): Promise<void> {
  if (snap.busy || snap.phase !== 'recording') return
  publish({ ...snap, busy: true })
  const result = await getBridge().stopRecording()
  if (!result.ok) {
    publish({ phase: 'idle', startedAt: 0, seconds: 0, message: result.message, busy: false })
    return
  }
  publish({ phase: 'review', startedAt: 0, seconds: result.seconds, message: '', busy: false })
}

export async function saveRecordingTake(): Promise<void> {
  if (snap.busy || snap.phase !== 'review') return
  publish({ ...snap, busy: true })
  const result = await getBridge().saveRecording()
  if (!result.ok) {
    publish({ ...snap, busy: false, message: result.canceled ? '' : result.message })
    return
  }
  publish({ phase: 'idle', startedAt: 0, seconds: 0, message: result.message, busy: false })
}

export async function redoRecording(): Promise<void> {
  if (snap.busy || snap.phase !== 'review') return
  publish({ ...snap, busy: true })
  await getBridge().discardRecording()
  publish({ phase: 'idle', startedAt: 0, seconds: 0, message: '', busy: false })
}

export function RecordPanel() {
  const state = useSyncExternalStore(subscribeRecording, recordingSnapshot, recordingSnapshot)
  const elapsed = useElapsed(state.phase, state.startedAt)
  const shown = state.phase === 'recording' ? elapsed : state.seconds

  return (
    <section className="record-panel" aria-label="Record">
      <h2>Record</h2>
      <p className="help">
        Records the sound playing through the inserts: the Model:Cycles, and every insert and performance effect layered over it.
      </p>
      <div className="record-live">
        {state.phase === 'recording' && <span className="record-dot" aria-hidden="true" />}
        <span className="record-time">{formatTake(shown)}</span>
      </div>
      {state.phase === 'review' && <p className="status-line">Save this recording, or record it again?</p>}
      <div className="action-row">
        {state.phase === 'review' ? (
          <>
            <button type="button" className="primary" disabled={state.busy} onClick={() => void saveRecordingTake()}>
              Save
            </button>
            <button type="button" disabled={state.busy} onClick={() => void redoRecording()}>
              Redo
            </button>
          </>
        ) : state.phase === 'recording' ? (
          <button type="button" className="record-stop" disabled={state.busy} onClick={() => void endRecording()}>
            Stop
          </button>
        ) : (
          <button type="button" className="primary" disabled={state.busy} onClick={() => void beginRecording()}>
            Record
          </button>
        )}
      </div>
      {state.message.length > 0 && <p className="status-line">{state.message}</p>}
    </section>
  )
}

function useElapsed(phase: RecordingPhase, startedAt: number): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (phase !== 'recording') return
    const tick = () => setElapsed(Math.max(0, (Date.now() - startedAt) / 1000))
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [phase, startedAt])
  return elapsed
}

function formatTake(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  const remain = whole % 60
  return `${minutes}:${String(remain).padStart(2, '0')}`
}
