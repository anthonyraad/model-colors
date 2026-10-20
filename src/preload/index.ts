import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { InsertSlot } from '../audio/inserts'
import type { DuckCommand } from '../audio/duck'
import type { StutterCommand } from '../audio/stutter'
import type { ControlsPreset } from '../audio/controlsPreset'
import type { MotionState } from '../audio/motion'
import type { Bridge } from '../midi/bridge'
import type { ControlEvent, MonitorEntry, NoteEvent, ProgramEvent, SentEvent } from '../midi/session'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

function subscribeStems(listener: (levels: number[], wave?: number[]) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, levels: number[], wave?: number[]) => listener(levels, wave)
  ipcRenderer.on('audio:stems', wrapped)
  return () => ipcRenderer.removeListener('audio:stems', wrapped)
}

const cycles: Bridge = {
  listPorts: () => ipcRenderer.invoke('midi:list'),
  connect: (inputId, outputId) => ipcRenderer.invoke('midi:connect', inputId, outputId),
  disconnect: () => ipcRenderer.invoke('midi:disconnect'),
  setChannels: (channels) => ipcRenderer.invoke('midi:channels', channels),
  setEcho: (enabled) => ipcRenderer.invoke('midi:echo', enabled),
  sendParameter: (target, parameterId, value, immediate) =>
    ipcRenderer.invoke('midi:parameter', target, parameterId, value, immediate),
  play: (messages) => ipcRenderer.invoke('midi:play', messages),
  realtime: (kind) => ipcRenderer.invoke('midi:realtime', kind),
  sendProgram: (index) => ipcRenderer.invoke('midi:program', index),
  onPatternApplied: (listener) =>
    subscribe<{ index: number; ok: boolean; detail: string }>('midi:pattern-applied', listener),
  solo: (index) => ipcRenderer.invoke('midi:solo', index),
  panic: () => ipcRenderer.invoke('midi:panic'),
  loopback: () => ipcRenderer.invoke('midi:loopback'),
  onMonitor: (listener) => subscribe<MonitorEntry>('midi:monitor', listener),
  onControl: (listener) => subscribe<ControlEvent>('midi:control', listener),
  onProgram: (listener) => subscribe<ProgramEvent>('midi:program-in', listener),
  onNote: (listener) => subscribe<NoteEvent>('midi:note-in', listener),
  onSent: (listener) => subscribe<SentEvent>('midi:sent', listener),
  onRealtime: (listener) => subscribe<'start' | 'clock' | 'stop'>('midi:realtime-in', listener),
  onStems: (listener) => subscribeStems(listener),
  onTransportToggle: (listener) => subscribe<void>('transport:toggle', listener),
  setFullscreen: (enabled) => ipcRenderer.invoke('window:fullscreen', enabled),
  onWindowFullscreen: (listener) => subscribe<boolean>('window:fullscreen', listener),
  listInserts: () => ipcRenderer.invoke('inserts:list'),
  listAudioDevices: () => ipcRenderer.invoke('inserts:devices'),
  startInserts: (inputId, outputId, slots: InsertSlot[], tempo: number) =>
    ipcRenderer.invoke('inserts:start', inputId, outputId, slots, tempo),
  stopInserts: () => ipcRenderer.invoke('inserts:stop'),
  openInsertEditor: (path, inputId) => ipcRenderer.invoke('inserts:editor', path, inputId),
  setOutputFilter: (
    move: 'hold' | 'high' | 'low' | 'open-high' | 'open-low' | 'reset' | 'return',
    reset?: { position: number; wait: number; span: number }
  ) => ipcRenderer.invoke('inserts:filter', move, reset),
  setOutputFilterShape: (slope: 12 | 24, resonance: 'none' | 'low' | 'medium' | 'high') =>
    ipcRenderer.invoke('inserts:filter-shape', slope, resonance),
  setOutputDuck: (command: DuckCommand) => ipcRenderer.invoke('inserts:duck', command),
  setOutputStutter: (command: StutterCommand) => ipcRenderer.invoke('inserts:stutter', command),
  setOutputMotion: (state: MotionState, bpm: number, beats: number, over: boolean, tapeBeats: number, tapeOver: boolean) =>
    ipcRenderer.invoke('inserts:motion', state, bpm, beats, over, tapeBeats, tapeOver),
  readInsertStates: () => ipcRenderer.invoke('inserts:states'),
  writeInsertStates: (states: (string | null)[]) => ipcRenderer.invoke('inserts:restore', states),
  listControlsPresets: () => ipcRenderer.invoke('presets:list'),
  saveControlsPreset: (preset: ControlsPreset) => ipcRenderer.invoke('presets:save', preset),
  deleteControlsPreset: (name: string) => ipcRenderer.invoke('presets:delete', name),
  startRecording: () => ipcRenderer.invoke('record:start'),
  stopRecording: () => ipcRenderer.invoke('record:stop'),
  saveRecording: () => ipcRenderer.invoke('record:save'),
  discardRecording: () => ipcRenderer.invoke('record:discard')
}

contextBridge.exposeInMainWorld('cycles', cycles)
