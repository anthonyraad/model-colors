import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session as electronSession } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { deleteControlsPreset, listControlsPresets, saveControlsPreset } from './controlsPresets'
import { discardRecording, listAudioDevices, listInserts, openInsertEditor, readInsertStates, saveRecording, setOutputDuck, setOutputFilter, setOutputFilterShape, setOutputMotion, setOutputStutter, setStemListener, startInserts, startRecording, stopInsertHost, stopInserts, stopRecording, writeInsertStates } from './insertHost'
import type { ControlsPreset } from '../audio/controlsPreset'
import type { InsertSlot } from '../audio/inserts'
import type { DuckCommand } from '../audio/duck'
import type { StutterCommand } from '../audio/stutter'
import type { FilterMove, FilterResonanceId, FilterSlopeDb } from '../audio/outputFilter'
import type { MotionState } from '../audio/motion'
import { MidiSession } from '../midi/session'
import { NodeMidiHardware } from '../midi/nodeMidiHardware'
import { attachPatternKeys, attachTransportKey } from './patternKeys'
import { patternIndexInBank, type ChannelSetup, type Target } from '../midi/routing'

let windowRef: BrowserWindow | null = null
let patternKeys: ReturnType<typeof attachPatternKeys> | null = null
let stopTransport: (() => void) | null = null

function bundled(name: string): string {
  const packed = join(process.resourcesPath, name)
  if (existsSync(packed)) return packed
  return join(process.cwd(), 'build', name)
}

function appIcon(): string {
  return bundled('icon-face.png')
}

const session = new MidiSession(new NodeMidiHardware(), {
  onMonitor: (entry) => windowRef?.webContents.send('midi:monitor', entry),
  onControl: (event) => windowRef?.webContents.send('midi:control', event),
  onProgram: (event) => windowRef?.webContents.send('midi:program-in', event),
  onNote: (event) => windowRef?.webContents.send('midi:note-in', event),
  onSent: (event) => windowRef?.webContents.send('midi:sent', event),
  onRealtime: (kind) => windowRef?.webContents.send('midi:realtime-in', kind)
})

function closeSplash(splash: BrowserWindow | null): void {
  if (!splash || splash.isDestroyed()) return
  splash.close()
}

function openSplash(then: (splash: BrowserWindow | null) => void): void {
  const file = bundled('splash.png')
  const page = bundled('splash.html')
  if (!existsSync(file) || !existsSync(page)) {
    then(null)
    return
  }
  const size = nativeImage.createFromPath(file).getSize()
  if (!(size.width > 0) || !(size.height > 0)) {
    then(null)
    return
  }
  const splash = new BrowserWindow({
    width: size.width,
    height: size.height,
    useContentSize: true,
    frame: false,
    resizable: false,
    movable: false,
    center: true,
    show: false,
    backgroundColor: '#cccccc',
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    thickFrame: false
  })
  let started = false
  const go = () => {
    if (started) return
    started = true
    if (!splash.isDestroyed()) splash.show()
    setTimeout(() => then(splash), 40)
  }
  splash.once('ready-to-show', go)
  splash.webContents.once('did-fail-load', go)
  setTimeout(go, 800)
  void splash.loadFile(page)
}

function createWindow(): void {
  if (process.env['CYCLES_SPLASH'] === '0') {
    openMain(null)
    return
  }
  openSplash((splash) => openMain(splash))
}

function openMain(splash: BrowserWindow | null): void {
  const preloadJs = join(__dirname, '../preload/index.js')
  const preloadMjs = join(__dirname, '../preload/index.mjs')
  windowRef = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#d6d6d6',
    icon: appIcon(),
    title: 'Model:Colors',
    autoHideMenuBar: true,
    webPreferences: {
      preload: existsSync(preloadMjs) ? preloadMjs : preloadJs,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  let revealed = false
  const reveal = () => {
    if (revealed) return
    revealed = true
    if (!windowRef || windowRef.isDestroyed()) {
      closeSplash(splash)
      return
    }
    if (!windowRef.isVisible()) windowRef.show()
    closeSplash(splash)
  }
  windowRef.once('ready-to-show', reveal)
  windowRef.webContents.once('did-fail-load', reveal)
  setTimeout(reveal, 8000)

  if (process.env['ELECTRON_RENDERER_URL']) windowRef.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else windowRef.loadFile(join(__dirname, '../renderer/index.html'))

  patternKeys?.stop()
  patternKeys = attachPatternKeys(windowRef.webContents, (slot) => {
    const index = patternIndexInBank(session.getPattern(), slot)
    const result = session.sendProgram(index)
    windowRef?.webContents.send('midi:pattern-applied', {
      index,
      ok: result.ok,
      detail: result.ok ? result.detail : result.reason
    })
  })
  stopTransport?.()
  stopTransport = attachTransportKey(windowRef.webContents, () => {
    windowRef?.webContents.send('transport:toggle')
  })
  windowRef.on('blur', () => patternKeys?.flush())
  windowRef.on('enter-full-screen', () => windowRef?.webContents.send('window:fullscreen', true))
  windowRef.on('leave-full-screen', () => windowRef?.webContents.send('window:fullscreen', false))
  windowRef.on('closed', () => {
    patternKeys?.stop()
    patternKeys = null
    stopTransport?.()
    stopTransport = null
    windowRef = null
    closeSplash(splash)
  })
}

app.whenReady().then(() => {
  setStemListener((levels, wave) => windowRef?.webContents.send('audio:stems', levels, wave))
  Menu.setApplicationMenu(null)
  electronSession.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media')
  })
  ipcMain.handle('midi:list', () => session.listPorts())
  ipcMain.handle('midi:connect', (_event, inputId: string | null, outputId: string | null) =>
    session.connect(inputId, outputId)
  )
  ipcMain.handle('midi:disconnect', () => {
    session.disconnect()
    return session.status()
  })
  ipcMain.handle('midi:channels', (_event, channels: ChannelSetup) => {
    session.setChannels(channels)
  })
  ipcMain.handle('midi:echo', (_event, enabled: boolean) => {
    session.setSimulatorEcho(enabled)
  })
  ipcMain.handle(
    'midi:parameter',
    (_event, target: Target, parameterId: string, value: number, immediate: boolean) =>
      session.sendParameter(target, parameterId, value, immediate)
  )
  ipcMain.handle('midi:play', (_event, messages: number[][]) => session.play(messages))
  ipcMain.handle('midi:realtime', (_event, kind: 'start' | 'clock' | 'stop') => session.realtime(kind))
  ipcMain.handle('midi:program', (_event, index: number) => session.sendProgram(index))
  ipcMain.handle('midi:solo', (_event, index: number | null) => session.solo(index))
  ipcMain.handle('midi:panic', () => session.panic())
  ipcMain.handle('midi:loopback', () => session.loopback())
  ipcMain.handle('window:fullscreen', (_event, enabled: boolean) => {
    windowRef?.setFullScreen(enabled)
  })
  ipcMain.handle('inserts:list', () => listInserts())
  ipcMain.handle('inserts:devices', () => listAudioDevices())
  ipcMain.handle('inserts:start', (_event, inputId: string | null, outputId: string | null, slots: InsertSlot[], tempo: number) =>
    startInserts(inputId, outputId, slots, tempo)
  )
  ipcMain.handle('inserts:stop', () => stopInserts())
  ipcMain.handle('inserts:editor', (_event, path: string, inputId: string | null) => openInsertEditor(path, inputId))
  ipcMain.handle(
    'inserts:filter',
    (_event, move: FilterMove, reset?: { position: number; wait: number; span: number }) => setOutputFilter(move, reset)
  )
  ipcMain.handle('inserts:filter-shape', (_event, slope: FilterSlopeDb, resonance: FilterResonanceId) =>
    setOutputFilterShape(slope, resonance)
  )
  ipcMain.handle('inserts:duck', (_event, command: DuckCommand) => setOutputDuck(command))
  ipcMain.handle('inserts:stutter', (_event, command: StutterCommand) => setOutputStutter(command))
  ipcMain.handle('inserts:motion', (_event, state: MotionState, bpm: number, beats: number, over: boolean, tapeBeats: number, tapeOver: boolean) =>
    setOutputMotion(state, bpm, beats, over, tapeBeats, tapeOver)
  )
  ipcMain.handle('inserts:states', () => readInsertStates())
  ipcMain.handle('inserts:restore', (_event, states: (string | null)[]) => writeInsertStates(states))
  ipcMain.handle('presets:list', () => listControlsPresets())
  ipcMain.handle('presets:save', (_event, preset: ControlsPreset) => saveControlsPreset(preset))
  ipcMain.handle('presets:delete', (_event, name: string) => deleteControlsPreset(name))
  ipcMain.handle('record:start', () => startRecording())
  ipcMain.handle('record:stop', () => stopRecording())
  ipcMain.handle('record:discard', () => discardRecording())
  ipcMain.handle('record:save', async () => {
    const stamp = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    const name = `Model-Colors-${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.wav`
    const options = {
      title: 'Save recording',
      defaultPath: name,
      filters: [{ name: 'WAV audio', extensions: ['wav'] }]
    }
    const picked = windowRef ? await dialog.showSaveDialog(windowRef, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return { ok: false as const, message: 'Save canceled.', canceled: true }
    const filePath = picked.filePath.toLowerCase().endsWith('.wav') ? picked.filePath : `${picked.filePath}.wav`
    return saveRecording(filePath)
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  session.disconnect()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  session.disconnect()
  stopInsertHost()
})
