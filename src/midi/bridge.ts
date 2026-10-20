import type { ControlsPreset } from '../audio/controlsPreset'
import type { DuckCommand } from '../audio/duck'
import type { StutterCommand } from '../audio/stutter'
import type { MotionState } from '../audio/motion'
import type { AudioEndpoint, InsertPlugin, InsertSlot } from '../audio/inserts'
import type { ControlEvent, MonitorEntry, NoteEvent, PortList, ProgramEvent, SendResult, SentEvent } from './session'
import type { ChannelSetup, Target } from './routing'

export type InsertCatalog =
  | { ok: true; plugins: InsertPlugin[]; inputs: AudioEndpoint[]; outputs: AudioEndpoint[] }
  | { ok: false; message: string }

export type InsertResult = { ok: true; message: string } | { ok: false; message: string }

export type RecordingStop = { ok: true; seconds: number } | { ok: false; message: string }

export type RecordingSave = { ok: true; message: string } | { ok: false; message: string; canceled?: boolean }

export type Bridge = {
  listPorts(): Promise<PortList>
  connect(inputId: string | null, outputId: string | null): Promise<{ ok: true } | { ok: false; reason: string }>
  disconnect(): Promise<{ inputId: null; outputId: null; inputName: null; outputName: null; connected: false }>
  setChannels(channels: ChannelSetup): Promise<void>
  setEcho(enabled: boolean): Promise<void>
  sendParameter(target: Target, parameterId: string, value: number, immediate: boolean): Promise<SendResult>
  play(messages: number[][]): Promise<{ ok: true } | { ok: false; reason: string }>
  realtime(kind: 'start' | 'clock' | 'stop'): Promise<{ ok: true } | { ok: false; reason: string }>
  sendProgram(index: number): Promise<{ ok: true; detail: string } | { ok: false; reason: string }>
  onPatternApplied(listener: (result: { index: number; ok: boolean; detail: string }) => void): () => void
  solo(index: number | null): Promise<{ ok: true; detail: string } | { ok: false; reason: string }>
  panic(): Promise<{ ok: true; detail: string } | { ok: false; reason: string }>
  loopback(): Promise<{ echoed: boolean; detail: string }>
  onMonitor(listener: (entry: MonitorEntry) => void): () => void
  onControl(listener: (event: ControlEvent) => void): () => void
  onProgram(listener: (event: ProgramEvent) => void): () => void
  onNote(listener: (event: NoteEvent) => void): () => void
  onSent(listener: (event: SentEvent) => void): () => void
  onRealtime(listener: (kind: 'start' | 'clock' | 'stop') => void): () => void
  onStems(listener: (levels: number[], wave?: number[]) => void): () => void
  onTransportToggle(listener: () => void): () => void
  setFullscreen(enabled: boolean): Promise<void>
  onWindowFullscreen(listener: (enabled: boolean) => void): () => void
  listInserts(): Promise<InsertCatalog>
  listAudioDevices(): Promise<{ ok: true; inputs: AudioEndpoint[]; outputs: AudioEndpoint[] } | { ok: false; message: string }>
  startInserts(inputId: string | null, outputId: string | null, slots: InsertSlot[], tempo: number): Promise<InsertResult>
  stopInserts(): Promise<InsertResult>
  openInsertEditor(path: string, inputId: string | null): Promise<InsertResult>
  setOutputFilter(
    move: 'hold' | 'high' | 'low' | 'open-high' | 'open-low' | 'reset' | 'return',
    reset?: { position: number; wait: number; span: number }
  ): Promise<InsertResult>
  setOutputFilterShape(slope: 12 | 24, resonance: 'none' | 'low' | 'medium' | 'high'): Promise<InsertResult>
  setOutputDuck(command: DuckCommand): Promise<InsertResult>
  setOutputStutter(command: StutterCommand): Promise<InsertResult>
  setOutputMotion(state: MotionState, bpm: number, beats: number, over: boolean, tapeBeats: number, tapeOver: boolean): Promise<InsertResult>
  readInsertStates(): Promise<{ ok: true; states: (string | null)[] } | { ok: false; message: string }>
  writeInsertStates(states: (string | null)[]): Promise<InsertResult>
  listControlsPresets(): Promise<ControlsPreset[]>
  saveControlsPreset(preset: ControlsPreset): Promise<ControlsPreset[]>
  deleteControlsPreset(name: string): Promise<ControlsPreset[]>
  startRecording(): Promise<InsertResult>
  stopRecording(): Promise<RecordingStop>
  saveRecording(): Promise<RecordingSave>
  discardRecording(): Promise<InsertResult>
}
