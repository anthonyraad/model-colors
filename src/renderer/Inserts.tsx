import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FADE_BARS, INSERT_KEYS, INSERT_LOOKS, INSERT_LOOK_SHORT, assignSlot, clearSlot, emptySlots, fadeBarsOf, moveSlotTo, setFadeBars, setFadeOutBars, togglePosition, type AudioEndpoint, type InsertPlugin, type InsertSlot } from '../audio/inserts'
import { DUCK_TRIGS } from '../audio/duck'
import { STUTTER_TRIGS } from '../audio/stutter'
import { buildPreset, slotsFromPreset, statesFromPreset, type ControlsAdvanced, type ControlsPreset } from '../audio/controlsPreset'
import { REVERSE_LENGTHS, TAPE_SPEEDS, type ReverseBars, type TapeSpeed } from '../audio/motion'
import { FILTER_RESET_RATES, FILTER_RESONANCE, FILTER_SLOPES, type FilterResetBeats, type FilterResonanceId, type FilterSlopeDb } from '../audio/outputFilter'
import { adoptArrivingCyclesAudio, isCyclesAudioName } from '../audio/capture'
import { getBridge } from '../midi/client'

export function Inserts({
  open,
  tempo,
  onClose,
  filterReset,
  onFilterReset,
  filterSlope,
  onFilterSlope,
  filterResonance,
  onFilterResonance,
  onLooks,
  duckTrigs,
  onDuckTrig,
  stutterTrigs,
  onStutterTrig,
  duckQuantize,
  onDuckQuantize,
  stutterQuantize,
  onStutterQuantize,
  reverseQuantize,
  onReverseQuantize,
  reverseBars,
  onReverseBars,
  reverseOver,
  onReverseOver,
  tapeQuantize,
  onTapeQuantize,
  tapeOver,
  onTapeOver,
  tapeSpeed,
  onTapeSpeed,
  onCaptureAdvanced,
  onRestoreAdvanced,
  onStatus
}: {
  open: boolean
  tempo: number
  onClose: () => void
  filterReset: FilterResetBeats
  onFilterReset: (beats: FilterResetBeats) => void
  filterSlope: FilterSlopeDb
  onFilterSlope: (slope: FilterSlopeDb) => void
  filterResonance: FilterResonanceId
  onFilterResonance: (resonance: FilterResonanceId) => void
  onLooks: (slots: readonly InsertSlot[]) => void
  duckTrigs: number
  onDuckTrig: (index: number) => void
  stutterTrigs: number
  onStutterTrig: (index: number) => void
  duckQuantize: boolean
  onDuckQuantize: (on: boolean) => void
  stutterQuantize: boolean
  onStutterQuantize: (on: boolean) => void
  reverseQuantize: boolean
  onReverseQuantize: (on: boolean) => void
  reverseBars: ReverseBars
  onReverseBars: (bars: ReverseBars) => void
  reverseOver: boolean
  onReverseOver: (on: boolean) => void
  tapeQuantize: boolean
  onTapeQuantize: (on: boolean) => void
  tapeOver: boolean
  onTapeOver: (on: boolean) => void
  tapeSpeed: TapeSpeed
  onTapeSpeed: (speed: TapeSpeed) => void
  onCaptureAdvanced: () => ControlsAdvanced
  onRestoreAdvanced: (next: ControlsAdvanced) => void
  onStatus: (message: string) => void
}) {
  const bridge = getBridge()
  const [plugins, setPlugins] = useState<InsertPlugin[]>([])
  const [inputs, setInputs] = useState<AudioEndpoint[]>([])
  const [outputs, setOutputs] = useState<AudioEndpoint[]>([])
  const [inputId, setInputId] = useState('')
  const [outputId, setOutputId] = useState('')
  const [slots, setSlots] = useState<InsertSlot[]>(emptySlots)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  useEffect(() => {
    if (status) onStatusRef.current(status)
  }, [status])
  const [page, setPage] = useState<'inserts' | 'advanced'>('inserts')
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [presets, setPresets] = useState<ControlsPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const presetRoot = useRef<HTMLDivElement>(null)

  async function refresh(): Promise<{ inputId: string; outputId: string } | null> {
    setBusy(true)
    const catalog = await bridge.listInserts()
    setBusy(false)
    if (!catalog.ok) {
      setStatus(catalog.message)
      return null
    }
    setPlugins(catalog.plugins)
    setInputs(catalog.inputs)
    setOutputs(catalog.outputs)
    const nextInput = inputId || preferred(catalog.inputs, /cycles|elektron|digital audio interface/i)
    const nextOutput = outputId || preferred(catalog.outputs, /focusrite/i)
    setInputId(nextInput)
    setOutputId(nextOutput)
    const cycles = catalog.inputs.find((device) => isCyclesAudioName(device.name))
    if (catalog.plugins.length === 0) setStatus('No VST3 plug-ins were found.')
    else if (cycles && cycles.state !== 'Active') setStatus('The Model:Cycles is plugged in, but Windows is not offering its audio input. Turn it on, then press Refresh.')
    else setStatus('')
    return { inputId: nextInput, outputId: nextOutput }
  }

  const slotsRef = useRef(slots)
  const runningRef = useRef(running)
  const heldOffRef = useRef(false)
  const inputIdRef = useRef(inputId)
  const outputIdRef = useRef(outputId)
  inputIdRef.current = inputId
  outputIdRef.current = outputId
  const tempoRef = useRef(tempo)
  const clockTempo = useRef(tempo)
  const lastClock = useRef(0)
  const applyRef = useRef<(next: InsertSlot[], hear: boolean) => Promise<void>>(async () => undefined)
  const onLooksRef = useRef(onLooks)
  onLooksRef.current = onLooks
  slotsRef.current = slots
  runningRef.current = running
  tempoRef.current = tempo

  useEffect(() => {
    return bridge.onRealtime((kind) => {
      if (kind !== 'clock') return
      const now = performance.now()
      const gap = now - lastClock.current
      lastClock.current = now
      if (gap > 8 && gap < 80) {
        const bpm = 2500 / gap
        if (bpm >= 40 && bpm <= 300) clockTempo.current += (bpm - clockTempo.current) * 0.25
      }
    })
  }, [bridge])

  function barsTempo(): number {
    const live = performance.now() - lastClock.current < 500 ? clockTempo.current : tempoRef.current
    return Math.round(live * 10) / 10
  }

  useEffect(() => {
    const known = new Set<string>()
    let stopped = false
    let routing = false
    const watch = async () => {
      if (routing || stopped) return
      routing = true
      try {
        const catalog = await bridge.listAudioDevices()
        if (stopped || !catalog.ok) return
        const cyclesId = adoptArrivingCyclesAudio(catalog.inputs, inputIdRef.current, known)
        for (const id of [...known]) {
          const still = catalog.inputs.some((device) => device.id === id && (device.state == null || device.state === 'Active') && isCyclesAudioName(device.name))
          if (!still) known.delete(id)
        }
        if (!cyclesId) {
          for (const device of catalog.inputs) {
            if ((device.state == null || device.state === 'Active') && isCyclesAudioName(device.name)) known.add(device.id)
          }
          if (runningRef.current || heldOffRef.current) return
          const cycles = catalog.inputs.find((device) => (device.state == null || device.state === 'Active') && isCyclesAudioName(device.name))
          if (!cycles) return
          const output = outputIdRef.current || catalog.outputs.find((device) => (device.state == null || device.state === 'Active') && /focusrite/i.test(device.name))?.id || ''
          const started = await bridge.startInserts(cycles.id, output || null, slotsRef.current, barsTempo())
          if (stopped || heldOffRef.current) return
          if (!started.ok) {
            setStatus(started.message)
            return
          }
          known.add(cycles.id)
          inputIdRef.current = cycles.id
          setInputs(catalog.inputs)
          setOutputs(catalog.outputs)
          setInputId(cycles.id)
          if (output) setOutputId(output)
          setRunning(true)
          setStatus('')
          return
        }
        const output = outputIdRef.current || catalog.outputs.find((device) => (device.state == null || device.state === 'Active') && /focusrite/i.test(device.name))?.id || ''
        const states = runningRef.current ? await bridge.readInsertStates() : null
        const started = await bridge.startInserts(cyclesId, output || null, slotsRef.current, barsTempo())
        if (stopped) return
        if (!started.ok) {
          setStatus(started.message)
          return
        }
        if (states?.ok && states.states.some((item) => item)) await bridge.writeInsertStates(states.states)
        if (stopped) return
        known.add(cyclesId)
        inputIdRef.current = cyclesId
        setInputs(catalog.inputs)
        setOutputs(catalog.outputs)
        setInputId(cyclesId)
        if (output) setOutputId(output)
        setRunning(true)
        setStatus('')
      } finally {
        routing = false
      }
    }
    const onChange = () => void watch()
    navigator.mediaDevices?.addEventListener('devicechange', onChange)
    const timer = window.setInterval(() => void watch(), 1000)
    return () => {
      stopped = true
      navigator.mediaDevices?.removeEventListener('devicechange', onChange)
      window.clearInterval(timer)
    }
  }, [bridge])

  const catalogLoaded = useRef(false)
  useEffect(() => {
    if (catalogLoaded.current) return
    catalogLoaded.current = true
    void (async () => {
      const chosen = await refresh()
      if (!chosen) return
      setBusy(true)
      const result = await bridge.startInserts(chosen.inputId || null, chosen.outputId || null, slotsRef.current, barsTempo())
      setBusy(false)
      if (result.ok) {
        setRunning(true)
        setStatus('')
      } else setStatus(result.message)
    })()
    // Playback starts with the app. Opening the panel does not start it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const index = INSERT_KEYS.indexOf(event.key.toLowerCase() as (typeof INSERT_KEYS)[number])
      if (index < 0 || !slotsRef.current[index]) return
      event.preventDefault()
      const current = slotsRef.current
      const next = togglePosition(current, index)
      slotsRef.current = next
      if (current[index]?.path) void applyRef.current(next, runningRef.current)
      else {
        setSlots(next)
        onLooksRef.current(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function place(from: number, to: number): void {
    const current = slotsRef.current
    if (!current[from]?.path) return
    const next = moveSlotTo(current, from, to)
    if (next.every((slot, slotIndex) => slot === current[slotIndex])) return
    slotsRef.current = next
    if (running) void apply(next, true)
    else {
      setSlots(next)
      onLooksRef.current(next)
    }
  }

  function startDrag(event: ReactPointerEvent<HTMLSpanElement>, index: number): void {
    if (event.button !== 0 || !slotsRef.current[index]?.path) return
    event.preventDefault()
    const grip = event.currentTarget
    const list = grip.closest('ol')
    const row = grip.closest('li')
    if (!list || !row) return
    try { grip.setPointerCapture(event.pointerId) } catch { /* A synthetic pointer has nothing to capture. */ }
    row.classList.add('is-drag')
    let target = index
    const rows = () => [...list.querySelectorAll(':scope > li')]
    const move = (ev: PointerEvent) => {
      const items = rows()
      let next = items.length - 1
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const rect = items[itemIndex].getBoundingClientRect()
        if (ev.clientY < rect.top + rect.height / 2) {
          next = itemIndex
          break
        }
      }
      target = next
      items.forEach((item, itemIndex) => item.classList.toggle('is-drop', itemIndex === next && itemIndex !== index))
    }
    const finish = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', finish)
      grip.removeEventListener('pointercancel', finish)
      row.classList.remove('is-drag')
      rows().forEach((item) => item.classList.remove('is-drop', 'is-drag'))
      place(index, target)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', finish)
    grip.addEventListener('pointercancel', finish)
  }

  async function apply(next: InsertSlot[], hear: boolean): Promise<void> {
    setSlots(next)
    onLooksRef.current(next)
    if (!hear) return
    setBusy(true)
    const result = await bridge.startInserts(inputId || null, outputId || null, next, barsTempo())
    setBusy(false)
    setRunning(result.ok)
    if (!result.ok) setStatus(result.message)
    else setStatus('')
  }
  applyRef.current = apply

  useEffect(() => {
    if (!presetsOpen) return
    void bridge.listControlsPresets().then(setPresets)
    const onPointer = (event: PointerEvent) => {
      if (!presetRoot.current?.contains(event.target as Node)) setPresetsOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [bridge, presetsOpen])

  async function savePreset(): Promise<void> {
    const name = presetName.trim()
    if (!name) return
    const read = await bridge.readInsertStates()
    if (!read.ok) {
      setStatus(read.message)
      return
    }
    const preset = buildPreset({
      name,
      savedAt: new Date().toISOString(),
      inputId,
      outputId,
      slots: slotsRef.current,
      states: read.states,
      advanced: onCaptureAdvanced()
    })
    const next = await bridge.saveControlsPreset(preset)
    setPresets(next)
    setPresetName('')
    setStatus(`Saved ${preset.name}.`)
  }

  async function loadPreset(preset: ControlsPreset): Promise<void> {
    const next = slotsFromPreset(preset)
    setInputId(preset.inputId)
    setOutputId(preset.outputId)
    slotsRef.current = next
    setSlots(next)
    onLooksRef.current(next)
    onRestoreAdvanced(preset.advanced)
    setBusy(true)
    const started = await bridge.startInserts(preset.inputId || null, preset.outputId || null, next, barsTempo())
    if (!started.ok) {
      setBusy(false)
      setRunning(false)
      setStatus(started.message)
      return
    }
    const restored = await bridge.writeInsertStates(statesFromPreset(preset))
    setBusy(false)
    setRunning(true)
    setStatus(restored.ok ? `Loaded ${preset.name}.` : restored.message)
  }

  async function toggle(): Promise<void> {
    setBusy(true)
    const result = running
      ? await bridge.stopInserts()
      : await bridge.startInserts(inputId || null, outputId || null, slots, barsTempo())
    setBusy(false)
    if (result.ok) {
      const next = !running
      setRunning(next)
      heldOffRef.current = !next
      setStatus('')
    } else setStatus(result.message)
  }

  return (
    <aside className="insert-panel" aria-label="Controls" hidden={!open}>
      <div className="insert-head">
        <h2>Controls</h2>
        <div className="insert-head-actions">
          <div className="insert-presets-anchor" ref={presetRoot}>
            <button type="button" aria-expanded={presetsOpen} aria-haspopup="dialog" onClick={() => setPresetsOpen((current) => !current)}>
              Save / Load
            </button>
            {presetsOpen && (
            <div className="insert-presets" role="dialog" aria-label="Presets">
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void savePreset()
                }}
              >
                <input
                  aria-label="Preset name"
                  value={presetName}
                  placeholder="Preset name"
                  onChange={(event) => setPresetName(event.target.value)}
                />
                <button type="submit" disabled={presetName.trim().length === 0}>Save</button>
              </form>
              {presets.length === 0 ? (
                <p>No presets yet.</p>
              ) : (
                <ul>
                  {presets.map((preset) => (
                    <li key={preset.name}>
                      <span>{preset.name}</span>
                      <button type="button" onClick={() => void loadPreset(preset)}>Load</button>
                      <button type="button" aria-label={`Remove ${preset.name}`} onClick={() => void bridge.deleteControlsPreset(preset.name).then(setPresets)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            )}
          </div>
          <button type="button" className="insert-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="insert-tabs" role="tablist" aria-label="Controls">
        <button type="button" role="tab" aria-selected={page === 'inserts'} className={page === 'inserts' ? 'is-on' : undefined} onClick={() => setPage('inserts')}>
          Inserts
        </button>
        <button type="button" role="tab" aria-selected={page === 'advanced'} className={page === 'advanced' ? 'is-on' : undefined} onClick={() => setPage('advanced')}>
          Advanced
        </button>
      </div>
      {page === 'inserts' && (
      <div role="tabpanel">
      <label className="insert-device">
        From
        <select value={inputId} onChange={(event) => setInputId(event.target.value)}>
          <option value="">Automatic</option>
          {inputs.map((device) => (
            <option key={device.id} value={device.id} disabled={device.state != null && device.state !== 'Active'}>
              {device.state != null && device.state !== 'Active'
                ? `${device.name} (not available)`
                : device.channels != null && device.channels >= 6
                  ? `${device.name} · ${device.channels} channels`
                  : device.name}
            </option>
          ))}
        </select>
      </label>
      <label className="insert-device">
        Speakers
        <select value={outputId} onChange={(event) => setOutputId(event.target.value)}>
          <option value="">Automatic</option>
          {outputs.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
        </select>
      </label>
      <ol className="insert-slots">
        {slots.map((slot, index) => (
          <li key={index} className={slot.look ? 'is-look' : undefined}>
            <span className="insert-key" title={INSERT_LOOKS[index]}>
              <b>{INSERT_KEYS[index]}</b>
              {INSERT_LOOK_SHORT[index]}
            </span>
            <span
              className={slot.path ? 'insert-grip' : 'insert-grip is-empty'}
              role={slot.path ? 'button' : undefined}
              aria-label={slot.path ? `Drag insert ${INSERT_KEYS[index].toUpperCase()}` : undefined}
              aria-hidden={slot.path ? undefined : true}
              onPointerDown={slot.path ? (event) => startDrag(event, index) : undefined}
            >
              <i />
              <i />
              <i />
            </span>
            <select
              aria-label={`Insert ${INSERT_KEYS[index].toUpperCase()}`}
              value={slot.path ?? ''}
              onChange={(event) => {
                const path = event.target.value
                const plugin = plugins.find((item) => item.path === path)
                void apply(plugin ? assignSlot(slotsRef.current, index, plugin) : clearSlot(slotsRef.current, index), running)
              }}
            >
              <option value="">Empty</option>
              {plugins.map((plugin) => <option key={plugin.path} value={plugin.path}>{plugin.name}</option>)}
            </select>
            <button
              type="button"
              aria-keyshortcuts={INSERT_KEYS[index]}
              aria-pressed={slot.look}
              title={`${INSERT_LOOKS[index]} ${slot.look ? 'on' : 'off'}`}
              onClick={() => {
                const next = togglePosition(slotsRef.current, index)
                if (slot.path) void apply(next, running)
                else {
                  slotsRef.current = next
                  setSlots(next)
                  onLooksRef.current(next)
                }
              }}
            >
              {slot.path ? (slot.bypass ? 'Off' : 'In') : slot.look ? 'On' : 'Off'}
            </button>
            <select
              className="insert-fade"
              aria-label={`Insert ${INSERT_KEYS[index].toUpperCase()} fade in`}
              title="Fade in, in bars"
              value={slot.fadeBars}
              onChange={(event) => {
                const next = setFadeBars(slots, index, fadeBarsOf(Number(event.target.value)))
                slotsRef.current = next
                setSlots(next)
              }}
            >
              {FADE_BARS.map((bars) => <option key={bars} value={bars}>{bars}</option>)}
            </select>
            <select
              className="insert-fade"
              aria-label={`Insert ${INSERT_KEYS[index].toUpperCase()} fade back`}
              title="Fade back, in bars"
              value={slot.fadeOutBars}
              onChange={(event) => {
                const next = setFadeOutBars(slots, index, fadeBarsOf(Number(event.target.value)))
                slotsRef.current = next
                setSlots(next)
              }}
            >
              {FADE_BARS.map((bars) => <option key={bars} value={bars}>{bars}</option>)}
            </select>
            <button
              type="button"
              disabled={!slot.path || busy}
              onClick={() => {
                if (!slot.path) return
                void bridge.openInsertEditor(slot.path, inputId || null).then((result) => {
                  if (!result.ok) setStatus(result.message)
                })
              }}
            >
              Open
            </button>
          </li>
        ))}
      </ol>
      <div className="insert-actions">
        <button type="button" onClick={() => void refresh()} disabled={busy}>Refresh</button>
        <button type="button" className="primary" onClick={() => void toggle()} disabled={busy}>
          {running ? 'Stop inserts' : 'Play through inserts'}
        </button>
      </div>
      </div>
      )}
      {page === 'advanced' && (
        <div className="insert-advanced-body" role="tabpanel">
          <div className="duck-trigs">
            <p>
              <span className="duck-name">
                <b>Duck</b>
                <span>N</span>
              </span>
              <span className="duck-meta">
                <button type="button" className={duckQuantize ? 'quantize is-on' : 'quantize'} aria-label="Quantize" aria-pressed={duckQuantize} onClick={() => onDuckQuantize(!duckQuantize)}>&gt;|&lt;</button>
              </span>
            </p>
            <div className="duck-trig-row" role="group" aria-label="Custom duck steps">
              {Array.from({ length: DUCK_TRIGS }, (_, index) => {
                const on = (duckTrigs & (1 << index)) !== 0
                return (
                  <button
                    key={index}
                    type="button"
                    className={on ? 'is-on' : undefined}
                    aria-pressed={on}
                    aria-label={`Duck step ${index + 1}`}
                    onClick={() => onDuckTrig(index)}
                  >
                    {index + 1}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="duck-trigs">
            <p>
              <span className="duck-name">
                <b>Stutter</b>
                <span>H</span>
              </span>
              <span className="duck-meta">
                <button type="button" className={stutterQuantize ? 'quantize is-on' : 'quantize'} aria-label="Quantize" aria-pressed={stutterQuantize} onClick={() => onStutterQuantize(!stutterQuantize)}>&gt;|&lt;</button>
              </span>
            </p>
            <div className="duck-trig-stack" role="group" aria-label="Custom stutter steps">
              {Array.from({ length: STUTTER_TRIGS / 16 }, (_, row) => row * 16).map((start) => (
                <div className="duck-trig-row" key={start}>
                  {Array.from({ length: 16 }, (_, offset) => {
                    const index = start + offset
                    const on = (stutterTrigs & (1 << index)) !== 0
                    return (
                      <button
                        key={index}
                        type="button"
                        className={on ? 'is-on' : undefined}
                        aria-pressed={on}
                        aria-label={`Stutter step ${index + 1}`}
                        onClick={() => onStutterTrig(index)}
                      >
                        {index + 1}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="duck-trigs section-rule">
            <p>
              <span className="duck-name">
                <b>Reverse</b>
                <span>-</span>
              </span>
              <span className="duck-meta">
                <button type="button" className={reverseOver ? 'quantize is-on' : 'quantize'} aria-label="Effects over reverse" aria-pressed={reverseOver} onClick={() => onReverseOver(!reverseOver)}>//</button>
                <button type="button" className={reverseQuantize ? 'quantize is-on' : 'quantize'} aria-label="Quantize" aria-pressed={reverseQuantize} onClick={() => onReverseQuantize(!reverseQuantize)}>&gt;|&lt;</button>
              </span>
            </p>
            <label className="insert-reset">
              Reverse length
              <select
                aria-label="Reverse length"
                value={reverseBars}
                onChange={(event) => onReverseBars(Number(event.target.value) as ReverseBars)}
              >
                {REVERSE_LENGTHS.map((length) => (
                  <option key={length.bars} value={length.bars}>
                    {length.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="duck-trigs">
            <p>
              <span className="duck-name">
                <b>Tape stop</b>
                <span>=</span>
              </span>
              <span className="duck-meta">
                <button type="button" className={tapeOver ? 'quantize is-on' : 'quantize'} aria-label="Effects over tape stop" aria-pressed={tapeOver} onClick={() => onTapeOver(!tapeOver)}>//</button>
                <button type="button" className={tapeQuantize ? 'quantize is-on' : 'quantize'} aria-label="Quantize" aria-pressed={tapeQuantize} onClick={() => onTapeQuantize(!tapeQuantize)}>&gt;|&lt;</button>
              </span>
            </p>
            <label className="insert-reset">
              Tape speed
              <select
                aria-label="Tape speed"
                value={tapeSpeed}
                onChange={(event) => onTapeSpeed(event.target.value as TapeSpeed)}
              >
                {TAPE_SPEEDS.map((speed) => (
                  <option key={speed.id} value={speed.id}>
                    {speed.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="insert-reset section-rule">
            Filter reset
            <select
              aria-label="Filter reset"
              value={filterReset}
              onChange={(event) => onFilterReset(Number(event.target.value) as FilterResetBeats)}
            >
              {FILTER_RESET_RATES.map((rate) => (
                <option key={rate.label} value={rate.beats}>
                  {rate.label}
                </option>
              ))}
            </select>
          </label>
          <div className="insert-shape">
            <label className="insert-reset">
              Slope
              <select
                aria-label="Filter slope"
                value={filterSlope}
                onChange={(event) => onFilterSlope(Number(event.target.value) as FilterSlopeDb)}
              >
                {FILTER_SLOPES.map((slope) => (
                  <option key={slope.db} value={slope.db}>
                    {slope.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="insert-reset">
              Q
              <select
                aria-label="Filter Q"
                value={filterResonance}
                onChange={(event) => onFilterResonance(event.target.value as FilterResonanceId)}
              >
                {FILTER_RESONANCE.map((resonance) => (
                  <option key={resonance.id} value={resonance.id}>
                    {resonance.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
      {status ? <p className="status-line">{status}</p> : null}
    </aside>
  )
}

function preferred(devices: readonly AudioEndpoint[], pattern: RegExp): string {
  return devices.find((device) => (device.state == null || device.state === 'Active') && pattern.test(device.name))?.id ?? ''
}
