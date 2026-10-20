import { parsePresetDocument, removePreset, upsertPreset, type ControlsPreset } from '../audio/controlsPreset'
import { MidiSession, type HardwarePorts } from './session'
import type { Bridge } from './bridge'

let browserBridge: Bridge | null = null

export function getBridge(): Bridge {
  if (typeof window !== 'undefined' && window.cycles) return window.cycles
  browserBridge ??= createBrowserBridge()
  return browserBridge
}

function createBrowserBridge(): Bridge {
  const monitors = new Set<Parameters<Bridge['onMonitor']>[0]>()
  const controls = new Set<Parameters<Bridge['onControl']>[0]>()
  const programs = new Set<Parameters<Bridge['onProgram']>[0]>()
  const notes = new Set<Parameters<Bridge['onNote']>[0]>()
  const sent = new Set<Parameters<Bridge['onSent']>[0]>()
  const realtime = new Set<Parameters<Bridge['onRealtime']>[0]>()
  const stems = new Set<Parameters<Bridge['onStems']>[0]>()
  const windowFullscreen = new Set<Parameters<Bridge['onWindowFullscreen']>[0]>()
  const hardware: HardwarePorts = {
    list: () => ({
      inputs: [],
      outputs: [],
      error: 'Hardware MIDI is available in the desktop window. This page is talking to the simulator.'
    }),
    open() {},
    close() {},
    send() {},
    onMessage() {}
  }
  const session = new MidiSession(hardware, {
    onMonitor: (entry) => monitors.forEach((listener) => listener(entry)),
    onControl: (event) => controls.forEach((listener) => listener(event)),
    onProgram: (event) => programs.forEach((listener) => listener(event)),
    onNote: (event) => notes.forEach((listener) => listener(event)),
    onSent: (event) => sent.forEach((listener) => listener(event)),
    onRealtime: (kind) => realtime.forEach((listener) => listener(kind))
  })
  const subscribe = <T>(set: Set<T>, listener: T) => {
    set.add(listener)
    return () => set.delete(listener)
  }
  return {
    listPorts: async () => session.listPorts(),
    connect: async (inputId, outputId) => session.connect(inputId, outputId),
    disconnect: async () => {
      await session.disconnect()
      return { inputId: null, outputId: null, inputName: null, outputName: null, connected: false }
    },
    setChannels: async (channels) => session.setChannels(channels),
    setEcho: async (enabled) => session.setSimulatorEcho(enabled),
    sendParameter: async (target, parameterId, value, immediate) =>
      session.sendParameter(target, parameterId, value, immediate),
    play: async (messages) => session.play(messages),
    realtime: async (kind) => session.realtime(kind),
    sendProgram: async (index) => session.sendProgram(index),
    onPatternApplied: () => () => {},
    solo: async (index) => session.solo(index),
    panic: async () => session.panic(),
    loopback: async () => session.loopback(),
    onMonitor: (listener) => subscribe(monitors, listener),
    onControl: (listener) => subscribe(controls, listener),
    onProgram: (listener) => subscribe(programs, listener),
    onNote: (listener) => subscribe(notes, listener),
    onSent: (listener) => subscribe(sent, listener),
    onRealtime: (listener) => subscribe(realtime, listener),
    onStems: (listener) => subscribe(stems, listener),
    onTransportToggle: () => () => {},
    setFullscreen: async () => {},
    onWindowFullscreen: (listener) => subscribe(windowFullscreen, listener),
    listInserts: async () => ({ ok: false, message: 'Inserts run in the desktop window.' }),
    listAudioDevices: async () => ({ ok: false, message: 'Inserts run in the desktop window.' }),
    startInserts: async () => ({ ok: false, message: 'Inserts run in the desktop window.' }),
    stopInserts: async () => ({ ok: true, message: 'Inserts are off.' }),
    openInsertEditor: async () => ({ ok: false, message: 'Inserts run in the desktop window.' }),
    setOutputFilter: async () => ({ ok: true, message: 'The filter runs in the desktop window.' }),
    setOutputFilterShape: async () => ({ ok: true, message: 'The filter runs in the desktop window.' }),
    setOutputDuck: async () => ({ ok: true, message: 'The ducker runs in the desktop window.' }),
    setOutputStutter: async () => ({ ok: true, message: 'The stutter runs in the desktop window.' }),
    setOutputMotion: async () => ({ ok: true, message: 'The effect runs in the desktop window.' }),
    readInsertStates: async () => ({ ok: true as const, states: [] }),
    writeInsertStates: async () => ({ ok: true as const, message: 'Plug-in settings restored.' }),
    listControlsPresets: async () => browserPresets(),
    saveControlsPreset: async (preset: ControlsPreset) => {
      const next = upsertPreset(browserPresets(), preset)
      localStorage.setItem(PRESET_KEY, JSON.stringify({ version: 1, presets: next }))
      return next
    },
    deleteControlsPreset: async (name: string) => {
      const next = removePreset(browserPresets(), name)
      localStorage.setItem(PRESET_KEY, JSON.stringify({ version: 1, presets: next }))
      return next
    },
    startRecording: async () => ({ ok: true as const, message: 'Recording.' }),
    stopRecording: async () => ({ ok: true as const, seconds: 3 }),
    saveRecording: async () => ({ ok: true as const, message: 'Saved the recording.' }),
    discardRecording: async () => ({ ok: true as const, message: 'Recording discarded.' })
  }
}

const PRESET_KEY = 'cycles-controls-presets'

function browserPresets(): ControlsPreset[] {
  try {
    return parsePresetDocument(JSON.parse(localStorage.getItem(PRESET_KEY) ?? ''))
  } catch {
    return []
  }
}
