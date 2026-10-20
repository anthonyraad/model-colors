import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Knob } from './Knob'
import { Performance } from './Performance'
import { RecordPanel } from './Record'
import { APPEARANCE_KEY, rememberedAppearance } from './appearance'
import { Inserts } from './Inserts'
import { Visualizer } from './Visualizer'
import { getBridge } from '../midi/client'
import { createDuckState, duckActive, duckPosition, duckRate, noteDuckClock, toggleDuck, toggleDuckTrig, type DuckRate, type DuckState } from '../audio/duck'
import { armCtrl, createHoldMode, markCtrlChord, pressHeld, releaseHeld, tapCtrl, writeDuck, writeStutter, type HoldMode } from '../audio/hold'
import { createStutterState, stutterActive, stutterRate, toggleStutter, toggleStutterTrig, type StutterRate, type StutterState } from '../audio/stutter'
import type { ControlsAdvanced } from '../audio/controlsPreset'
import { REVERSE_QUANTIZE_BEATS, createMotionState, dropReverse, motionActive, motionKind, motionSnap, reverseLengthBeats, tapeWindBeats, toggleMotion, writeMotion, type MotionKind, type MotionState, type ReverseBars, type TapeSpeed } from '../audio/motion'
import { QUANTIZE_DOWNBEAT_BEATS, quantizeBarEnd, quantizeDelay } from '../audio/quantize'
import type { FilterResetBeats, FilterResonanceId, FilterSlopeDb } from '../audio/outputFilter'
import type { InsertSlot, LookGate } from '../audio/inserts'
import { clockGapMs } from '../midi/devicePlay'
import { emptyPatternChord, stepPatternChord } from '../midi/patternChord'
import { adoptArrivingCycles, defaultPortId, looksLikeModelCycles, modelCyclesPortIds, parameterById, protocol, valueCaption } from '../midi/protocol'
import { modelTg, samplerDialName, samplerKnobCaption } from '../midi/modelTg'
import {
  applyIncomingControl,
  applyIncomingProgram,
  defaultChannels,
  MUTE_OFF,
  MUTE_ON,
  patternIndexInBank,
  patternLabel,
  patternSlotFromDigits,
  sharedChannelWarnings,
  soloLevels,
  targetKey,
  toggleMuteFlags,
  type ChannelSetup,
  type Target
} from '../midi/routing'
import type { MonitorEntry, PortInfo } from '../midi/session'

type ValueState = { value: number; status: 'local' | 'sent' | 'observed' }

const TRACKS = [
  { name: 'T1', hint: 'Track 1' },
  { name: 'T2', hint: 'Track 2' },
  { name: 'T3', hint: 'Track 3' },
  { name: 'T4', hint: 'Track 4' },
  { name: 'T5', hint: 'Track 5' },
  { name: 'T6', hint: 'Track 6' }
]

const TRACK_GROUPS = [
  { title: 'Tone', ids: ['pitch', 'decay', 'color', 'shape', 'sweep', 'contour', 'machine'] },
  { title: 'Level', ids: ['note', 'mute', 'trackLevel', 'pan', 'volumeDist'] },
  { title: 'Sends', ids: ['delaySend', 'reverbSend'] },
  { title: 'Motion', ids: ['punch', 'gate', 'swing', 'chance'] },
  { title: 'LFO', ids: ['lfoSpeed', 'lfoMultiplier', 'lfoFade', 'lfoDestination', 'lfoWaveform', 'lfoPhase', 'lfoReset', 'lfoDepth'] }
]

const FX_GROUPS = [
  { title: 'Delay', ids: ['delayTime', 'delayFeedback'] },
  { title: 'Reverb', ids: ['reverbSize', 'reverbTone'] }
]

export function App() {
  const bridge = useMemo(() => getBridge(), [])
  const [inputs, setInputs] = useState<PortInfo[]>([])
  const [outputs, setOutputs] = useState<PortInfo[]>([])
  const [nativeError, setNativeError] = useState<string | null>(null)
  const [inputId, setInputId] = useState('sim:input')
  const [outputId, setOutputId] = useState('sim:output')
  const [connectedInput, setConnectedInput] = useState<string | null>(null)
  const [connectedOutput, setConnectedOutput] = useState<string | null>(null)
  const connectedInputRef = useRef<string | null>(null)
  const connectedOutputRef = useRef<string | null>(null)
  connectedInputRef.current = connectedInput
  connectedOutputRef.current = connectedOutput
  const [inputName, setInputName] = useState<string | null>(null)
  const [outputName, setOutputName] = useState<string | null>(null)
  const [channels, setChannels] = useState<ChannelSetup>(defaultChannels())
  const channelsRef = useRef(channels)
  channelsRef.current = channels
  const [target, setTarget] = useState<Target>({ kind: 'track', index: 0 })
  const [values, setValues] = useState<Record<string, ValueState>>({})
  const [monitor, setMonitor] = useState<MonitorEntry[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [panicArmed, setPanicArmed] = useState(false)
  const [echo, setEcho] = useState(true)
  const [monitorHeight, setMonitorHeight] = useState(196)
  const [draggingMonitor, setDraggingMonitor] = useState(false)
  const [panels, setPanels] = useState(() => TRACKS.map(() => ({ machine: 'kick', samplerMode: 'oneshot' })))
  const [soloed, setSoloed] = useState<number | null>(null)
  const [muted, setMuted] = useState<boolean[]>(() => [false, false, false, false, false, false])
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const [pattern, setPattern] = useState<number | null>(null)
  const patternRef = useRef<number | null>(null)
  patternRef.current = pattern
  const [patternCue, setPatternCue] = useState('')
  const patternCueTimer = useRef(0)
  const choosePatternRef = useRef<(index: number) => void>(() => {})
  const [stage, setStage] = useState<'record' | 'sound' | 'setup'>('record')
  const [view, setView] = useState<'editor' | 'visual'>('visual')
  const [insertsOpen, setInsertsOpen] = useState(false)
  const [filterReset, setFilterReset] = useState<FilterResetBeats>(0)
  const [filterSlope, setFilterSlope] = useState<FilterSlopeDb>(12)
  const [filterResonance, setFilterResonance] = useState<FilterResonanceId>('none')
  const [filled, setFilled] = useState(false)
  const [appearance, setAppearance] = useState<'dark' | 'light'>(() => {
    try {
      return rememberedAppearance(localStorage.getItem(APPEARANCE_KEY))
    } catch {
      return 'light'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(APPEARANCE_KEY, appearance)
    } catch {
      // The choice still applies for this visit.
    }
  }, [appearance])
  const tempoRef = useRef(120)
  const duckRef = useRef<DuckState>(createDuckState())
  const stutterRef = useRef<StutterState>(createStutterState())
  const duckIntent = useRef<DuckState>(createDuckState())
  const stutterIntent = useRef<StutterState>(createStutterState())
  const duckQuantizeRef = useRef(false)
  const stutterQuantizeRef = useRef(false)
  const reverseQuantizeRef = useRef(false)
  const tapeQuantizeRef = useRef(false)
  const reverseBarsRef = useRef<ReverseBars>(4)
  const reverseOverRef = useRef(false)
  const tapeOverRef = useRef(false)
  const tapeSpeedRef = useRef<TapeSpeed>('medium')
  const motionWaitKind = useRef<MotionKind | null>(null)
  const duckWait = useRef<number | null>(null)
  const stutterWait = useRef<number | null>(null)
  const motionWait = useRef<number | null>(null)
  const quantizeFrame = useRef(0)
  const motionRef = useRef<MotionState>(createMotionState())
  const motionIntent = useRef<MotionState>(createMotionState())
  const holdRef = useRef<HoldMode>(createHoldMode())
  const heldDucks = useRef<DuckRate[]>([])
  const heldStutters = useRef<StutterRate[]>([])
  const heldMotions = useRef<{ label: string; kind: MotionKind }[]>([])
  const [duckTrigs, setDuckTrigs] = useState(0)
  const [stutterTrigs, setStutterTrigs] = useState(0)
  const [duckQuantize, setDuckQuantize] = useState(false)
  const [stutterQuantize, setStutterQuantize] = useState(false)
  const [reverseQuantize, setReverseQuantize] = useState(false)
  const [tapeQuantize, setTapeQuantize] = useState(false)
  const [reverseBars, setReverseBars] = useState<ReverseBars>(4)
  const [reverseOver, setReverseOver] = useState(false)
  const [tapeOver, setTapeOver] = useState(false)
  const [tapeSpeed, setTapeSpeed] = useState<TapeSpeed>('medium')
  duckQuantizeRef.current = duckQuantize
  stutterQuantizeRef.current = stutterQuantize
  reverseQuantizeRef.current = reverseQuantize
  tapeQuantizeRef.current = tapeQuantize
  reverseBarsRef.current = reverseBars
  reverseOverRef.current = reverseOver
  tapeOverRef.current = tapeOver
  tapeSpeedRef.current = tapeSpeed
  const looksRef = useRef<LookGate[]>(
    Array.from({ length: 6 }, () => ({ on: false, fadeBars: 0 as const, fadeOutBars: 0 as const }))
  )
  const publishDuckRef = useRef<(seek?: boolean) => void>(() => {})
  const publishStutterRef = useRef<(seek?: boolean) => void>(() => {})
  const publishMotionRef = useRef<() => void>(() => {})
  publishDuckRef.current = (seek = true) => {
    const duck = duckRef.current
    const place = duckPosition(duck, performance.now(), tempoRef.current)
    const active = duckActive(duck)
    void bridge.setOutputDuck({
      division: duck.division,
      bpm: place.bpm,
      beats: place.beats,
      running: active,
      seek: seek && active,
      custom: duck.custom,
      trigs: duck.trigs
    })
  }
  publishStutterRef.current = (seek = true) => {
    const stutter = stutterRef.current
    const place = duckPosition(duckRef.current, performance.now(), tempoRef.current)
    const active = stutterActive(stutter)
    void bridge.setOutputStutter({
      division: stutter.division,
      bpm: place.bpm,
      beats: place.beats,
      running: active,
      seek: seek && active,
      custom: stutter.custom,
      trigs: stutter.trigs
    })
  }
  publishMotionRef.current = () => {
    const place = duckPosition(duckRef.current, performance.now(), tempoRef.current)
    void bridge.setOutputMotion(motionRef.current, place.bpm, reverseLengthBeats(reverseBarsRef.current), reverseOverRef.current, tapeWindBeats(tapeSpeedRef.current), tapeOverRef.current)
  }
  const copyDuck = () => {
    duckRef.current.division = duckIntent.current.division
    duckRef.current.label = duckIntent.current.label
    duckRef.current.custom = duckIntent.current.custom
    publishDuckRef.current(true)
  }
  const copyStutter = () => {
    stutterRef.current.division = stutterIntent.current.division
    stutterRef.current.label = stutterIntent.current.label
    stutterRef.current.custom = stutterIntent.current.custom
    publishStutterRef.current(true)
  }
  const tickQuantizeRef = useRef<() => void>(() => {})
  tickQuantizeRef.current = () => {
    const place = duckPosition(duckRef.current, performance.now(), tempoRef.current)
    if (duckWait.current != null && place.beats + 0.008 >= duckWait.current) {
      duckWait.current = null
      copyDuck()
    }
    if (stutterWait.current != null && place.beats + 0.008 >= stutterWait.current) {
      stutterWait.current = null
      copyStutter()
    }
    if (motionWait.current != null && place.beats + 0.008 >= motionWait.current) {
      motionWait.current = null
      motionWaitKind.current = null
      copyMotion()
    }
  }
  const copyMotion = () => {
    motionRef.current.reverse = motionIntent.current.reverse
    motionRef.current.tape = motionIntent.current.tape
    publishMotionRef.current()
  }
  const pumpQuantize = () => {
    if (quantizeFrame.current) return
    const loop = () => {
      tickQuantizeRef.current()
      if (duckWait.current != null || stutterWait.current != null || motionWait.current != null) quantizeFrame.current = requestAnimationFrame(loop)
      else quantizeFrame.current = 0
    }
    quantizeFrame.current = requestAnimationFrame(loop)
  }
  const requestDuckRef = useRef<() => void>(() => {})
  const requestStutterRef = useRef<() => void>(() => {})
  const requestMotionRef = useRef<() => void>(() => {})
  requestDuckRef.current = () => {
    if (!duckQuantizeRef.current) {
      duckWait.current = null
      copyDuck()
      return
    }
    const place = duckPosition(duckRef.current, performance.now(), tempoRef.current)
    const wait = quantizeDelay(place.beats, QUANTIZE_DOWNBEAT_BEATS)
    if (!(wait > 0.01)) {
      duckWait.current = null
      copyDuck()
      return
    }
    duckWait.current = place.beats + wait
    pumpQuantize()
  }
  requestStutterRef.current = () => {
    if (!stutterQuantizeRef.current) {
      stutterWait.current = null
      copyStutter()
      return
    }
    const place = duckPosition(duckRef.current, performance.now(), tempoRef.current)
    const wait = quantizeDelay(place.beats, QUANTIZE_DOWNBEAT_BEATS)
    if (!(wait > 0.01)) {
      stutterWait.current = null
      copyStutter()
      return
    }
    stutterWait.current = place.beats + wait
    pumpQuantize()
  }
  requestMotionRef.current = () => {
    const snap = motionSnap(motionIntent.current, motionRef.current, reverseQuantizeRef.current, tapeQuantizeRef.current)
    if (!snap) {
      motionWait.current = null
      motionWaitKind.current = null
      copyMotion()
      return
    }
    const place = duckPosition(duckRef.current, performance.now(), tempoRef.current)
    const wait = quantizeBarEnd(place.beats, REVERSE_QUANTIZE_BEATS)
    if (!(wait > 0.01)) {
      motionWait.current = null
      motionWaitKind.current = null
      copyMotion()
      return
    }
    motionWait.current = place.beats + wait
    motionWaitKind.current = snap
    pumpQuantize()
  }
  const [tempo, setTempo] = useState(120)
  tempoRef.current = tempo
  const [devicePlaying, setDevicePlaying] = useState(false)
  const devicePlayRef = useRef(false)
  const clockTimerRef = useRef(0)
  const appliedDefault = useRef(false)

  const haltDeviceClock = () => {
    devicePlayRef.current = false
    setDevicePlaying(false)
    window.clearTimeout(clockTimerRef.current)
    clockTimerRef.current = 0
  }

  const stopDevicePlay = () => {
    const wasPlaying = devicePlayRef.current
    haltDeviceClock()
    setDevicePlaying(false)
    if (!wasPlaying) return
    noteDuckClock(duckRef.current, 'stop', performance.now(), 'app')
    void bridge.realtime('stop')
  }

  const startDevicePlay = () => {
    devicePlayRef.current = true
    const started = performance.now()
    noteDuckClock(duckRef.current, 'start', started, 'app')
    let next = started + clockGapMs(tempoRef.current)
    const pump = () => {
      if (!devicePlayRef.current) return
      const tick = performance.now()
      noteDuckClock(duckRef.current, 'clock', tick, 'app')
      void bridge.realtime('clock')
      const gap = clockGapMs(tempoRef.current)
      next += gap
      if (next < tick) next = tick + gap
      clockTimerRef.current = window.setTimeout(pump, Math.max(0, next - performance.now()))
    }
    void bridge.realtime('start').then((result) => {
      if (!devicePlayRef.current) return
      if (!result.ok) {
        haltDeviceClock()
        setDevicePlaying(false)
        noteDuckClock(duckRef.current, 'stop', performance.now(), 'app')
        setNotice(result.reason)
        return
      }
      setDevicePlaying(true)
      clockTimerRef.current = window.setTimeout(pump, Math.max(0, next - performance.now()))
    })
  }

  const endReverse = (followHeld: boolean) => {
    const pending = motionWaitKind.current === 'reverse'
    const dropped = dropReverse(motionIntent.current, motionRef.current) || pending
    heldMotions.current = heldMotions.current.filter((item) => item.kind !== 'reverse')
    if (pending) {
      motionWait.current = null
      motionWaitKind.current = null
    }
    if (dropped) publishMotionRef.current()
    if (!followHeld || !holdRef.current.enabled) return
    const top = heldMotions.current.at(-1)
    writeMotion(motionIntent.current, top ? top.kind : null)
    requestMotionRef.current()
  }

  const toggleDevicePlayRef = useRef(() => {})
  toggleDevicePlayRef.current = () => {
    endReverse(true)
    if (devicePlayRef.current) stopDevicePlay()
    else startDevicePlay()
  }

  const refresh = useCallback(async () => {
    const ports = await bridge.listPorts()
    setInputs(ports.inputs)
    setOutputs(ports.outputs)
    setNativeError(ports.nativeError)
    if (appliedDefault.current) return
    const nextInput = defaultPortId(ports.inputs, 'sim:input', 'sim:input')
    const nextOutput = defaultPortId(ports.outputs, 'sim:output', 'sim:output')
    if (nextInput === 'sim:input' && nextOutput === 'sim:output') return
    appliedDefault.current = true
    const input = nextInput === 'sim:input' ? null : nextInput
    const output = nextOutput === 'sim:output' ? null : nextOutput
    setInputId(input ?? '')
    setOutputId(output ?? '')
    const result = await bridge.connect(input, output)
    if (!result.ok) {
      setNotice(result.reason)
      return
    }
    setConnectedInput(input)
    setConnectedOutput(output)
    setInputName(ports.inputs.find((port) => port.id === input)?.name ?? null)
    setOutputName(ports.outputs.find((port) => port.id === output)?.name ?? null)
  }, [bridge])

  useEffect(() => {
    void bridge.setChannels(channels)
  }, [bridge, channels])

  useEffect(() => {
    const onClock = bridge.onRealtime((kind) => {
      noteDuckClock(duckRef.current, kind, performance.now(), 'device')
      if (kind !== 'clock') {
        publishDuckRef.current()
        publishStutterRef.current()
        publishMotionRef.current()
      }
    })
    const timer = window.setInterval(() => {
      if (duckActive(duckRef.current)) publishDuckRef.current(true)
      if (stutterActive(stutterRef.current)) publishStutterRef.current(true)
      if (motionActive(motionRef.current)) publishMotionRef.current()
    }, 250)
    return () => {
      onClock()
      window.clearInterval(timer)
    }
  }, [bridge])

  useEffect(() => {
    const typing = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }
    let chord = emptyPatternChord()
    let fallback = 0
    const clearFallback = () => {
      window.clearTimeout(fallback)
      fallback = 0
    }
    const onPattern = (event: KeyboardEvent, type: 'keyDown' | 'keyUp'): boolean => {
      if (window.cycles) return false
      const step = stepPatternChord(chord, {
        type,
        code: event.code,
        key: event.key,
        shift: event.shiftKey || event.getModifierState('Shift'),
        repeat: event.repeat,
        control: event.ctrlKey,
        alt: event.altKey,
        meta: event.metaKey
      })
      chord = step.chord
      if (step.capture) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      if (step.fallbackMs === null) clearFallback()
      else if (typeof step.fallbackMs === 'number') {
        clearFallback()
        fallback = window.setTimeout(() => {
          fallback = 0
          const slot = patternSlotFromDigits(chord.digits)
          chord = emptyPatternChord()
          if (slot != null) choosePatternRef.current(patternIndexInBank(patternRef.current, slot))
        }, step.fallbackMs)
      }
      if (step.slot != null) {
        clearFallback()
        choosePatternRef.current(patternIndexInBank(patternRef.current, step.slot))
      }
      return step.capture || step.slot != null
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'F12') {
        event.preventDefault()
        if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
          setAppearance((current) => (current === 'light' ? 'dark' : 'light'))
        }
        return
      }
      if (event.code === 'Space') {
        if (window.cycles) return
        event.preventDefault()
        if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) toggleDevicePlayRef.current()
        return
      }
      if (typing(event)) return
      if (onPattern(event, 'keyDown')) return
      if (event.key === 'Control') {
        if (!event.repeat) armCtrl(holdRef.current)
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) markCtrlChord(holdRef.current)
      if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const stutter = stutterRate(event.key)
        if (stutter) {
          event.preventDefault()
          if (holdRef.current.enabled) writeStutter(stutterIntent.current, pressHeld(heldStutters.current, stutter))
          else toggleStutter(stutterIntent.current, stutter)
          requestStutterRef.current()
        }
        const rate = duckRate(event.key)
        if (rate) {
          event.preventDefault()
          if (holdRef.current.enabled) writeDuck(duckIntent.current, pressHeld(heldDucks.current, rate))
          else toggleDuck(duckIntent.current, rate)
          requestDuckRef.current()
        }
        const motion = motionKind(event.code, event.key, event.shiftKey)
        if (motion) {
          event.preventDefault()
          const held = { label: motion === 'reverse' ? 'Reverse' : 'Tape stop', kind: motion }
          if (holdRef.current.enabled) writeMotion(motionIntent.current, pressHeld(heldMotions.current, held).kind)
          else toggleMotion(motionIntent.current, motion)
          if (motion === 'tape') endReverse(false)
          requestMotionRef.current()
        }
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (onPattern(event, 'keyUp')) return
      if (event.key === 'Control') {
        if (!tapCtrl(holdRef.current)) return
        if (!holdRef.current.enabled) {
          heldDucks.current = []
          heldStutters.current = []
          heldMotions.current = []
        }
        return
      }
      if (!holdRef.current.enabled || typing(event) || event.ctrlKey || event.metaKey || event.altKey) return
      const stutter = stutterRate(event.key)
      if (stutter) {
        const next = releaseHeld(heldStutters.current, stutter.label)
        if (next === undefined) return
        writeStutter(stutterIntent.current, next)
        requestStutterRef.current()
      }
      const rate = duckRate(event.key)
      if (rate) {
        const next = releaseHeld(heldDucks.current, rate.label)
        if (next === undefined) return
        writeDuck(duckIntent.current, next)
        requestDuckRef.current()
      }
      const motion = motionKind(event.code, event.key, event.shiftKey)
      if (motion) {
        const next = releaseHeld(heldMotions.current, motion === 'reverse' ? 'Reverse' : 'Tape stop')
        if (next === undefined) return
        writeMotion(motionIntent.current, next ? next.kind : null)
        requestMotionRef.current()
      }
    }
    const onBlur = () => {
      const slot = window.cycles ? null : patternSlotFromDigits(chord.digits)
      chord = emptyPatternChord()
      clearFallback()
      if (slot != null) choosePatternRef.current(patternIndexInBank(patternRef.current, slot))
      if (!holdRef.current.enabled) return
      heldDucks.current = []
      heldStutters.current = []
      heldMotions.current = []
      duckWait.current = null
      stutterWait.current = null
      motionWait.current = null
      motionWaitKind.current = null
      writeDuck(duckIntent.current, null)
      writeStutter(stutterIntent.current, null)
      writeDuck(duckRef.current, null)
      writeStutter(stutterRef.current, null)
      writeMotion(motionIntent.current, null)
      writeMotion(motionRef.current, null)
      publishDuckRef.current(false)
      publishStutterRef.current(false)
      publishMotionRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      clearFallback()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      if (quantizeFrame.current) cancelAnimationFrame(quantizeFrame.current)
      quantizeFrame.current = 0
    }
  }, [])

  useEffect(() => {
    void refresh()
    const offMonitor = bridge.onMonitor((entry) => {
      setMonitor((current) => [...current.slice(-249), entry])
    })
    const offSent = bridge.onSent((event) => {
      const key = targetKey(event.target, event.parameterId)
      setValues((current) => {
        const existing = current[key]
        if (!existing || existing.value !== event.value) return current
        return { ...current, [key]: { value: existing.value, status: event.observed ? 'observed' : 'sent' } }
      })
    })
    const offControl = bridge.onControl((event) => {
      const applied = applyIncomingControl(event.controller, event.channel, channelsRef.current)
      if (applied.kind === 'ignore') return
      if (applied.kind === 'unmapped') {
        const parameter = parameterById(applied.parameterId)
        const name = parameter?.name ?? applied.parameterId
        const where = parameter?.group === 'fx' ? 'Set the FX channel' : 'Set a track'
        setNotice(`${name} arrived on channel ${applied.channel}. ${where} to that channel to show it.`)
        return
      }
      if (applied.kind === 'learn-fx') {
        const next = { ...channelsRef.current, fx: applied.channel }
        channelsRef.current = next
        setChannels(next)
      }
      const key = targetKey(applied.target, applied.parameterId)
      setValues((current) => ({ ...current, [key]: { value: event.value, status: 'observed' } }))
      if (applied.parameterId === 'mute' && applied.target.kind === 'track') {
        const channel = channelsRef.current.tracks[applied.target.index]
        const on = event.value >= 64
        const next = channelsRef.current.tracks.map((trackChannel, track) =>
          trackChannel === channel ? on : (mutedRef.current[track] ?? false)
        )
        mutedRef.current = next
        setMuted(next)
      }
    })
    const offSlot = bridge.onPatternApplied((result) => {
      setNotice(result.detail)
      const label = patternLabel(result.index)
      setPatternCue(result.ok ? (devicePlayRef.current ? `${label} at pattern end` : label) : result.detail)
      window.clearTimeout(patternCueTimer.current)
      patternCueTimer.current = window.setTimeout(() => setPatternCue(''), 1800)
      if (result.ok) setPattern(result.index)
    })
    const offTransport = bridge.onTransportToggle(() => toggleDevicePlayRef.current())
    const offProgram = bridge.onProgram((event) => {
      const applied = applyIncomingProgram(event.program, event.channel, channelsRef.current)
      if (applied.programChannel !== channelsRef.current.program) {
        const next = { ...channelsRef.current, program: applied.programChannel }
        channelsRef.current = next
        setChannels(next)
      }
      if (applied.pattern != null) setPattern(applied.pattern)
    })
    return () => {
      offMonitor()
      offSent()
      offControl()
      offProgram()
      offTransport()
      offSlot()
    }
  }, [bridge, refresh])

  useEffect(() => {
    const known = new Set<string>()
    let stopped = false
    let running = false
    const watch = async () => {
      if (running || stopped) return
      running = true
      try {
        const ports = await bridge.listPorts()
        if (stopped) return
        setInputs(ports.inputs)
        setOutputs(ports.outputs)
        setNativeError(ports.nativeError)
        if (!ports.nativeError) {
          const choice = adoptArrivingCycles(ports.inputs, ports.outputs, connectedInputRef.current, connectedOutputRef.current, known)
          known.clear()
          for (const id of modelCyclesPortIds(ports.inputs)) known.add(id)
          for (const id of modelCyclesPortIds(ports.outputs)) known.add(id)
          if (choice) {
            const result = await bridge.connect(choice.inputId, choice.outputId)
            if (!stopped && result.ok) {
              setInputId(choice.inputId ?? '')
              setOutputId(choice.outputId ?? '')
              setConnectedInput(choice.inputId)
              setConnectedOutput(choice.outputId)
              setInputName(ports.inputs.find((port) => port.id === choice.inputId)?.name ?? null)
              setOutputName(ports.outputs.find((port) => port.id === choice.outputId)?.name ?? null)
              setNotice(null)
              if (devicePlayRef.current) void bridge.realtime('start')
            } else if (!stopped && !result.ok) setNotice(result.reason)
          }
        }
      } finally {
        running = false
      }
    }
    const timer = window.setInterval(() => void watch(), 1000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [bridge])

  async function connect(): Promise<void> {
    const result = await bridge.connect(inputId || null, outputId || null)
    if (!result.ok) {
      setNotice(result.reason)
      return
    }
    const statusInput = inputs.find((port) => port.id === inputId)
    const statusOutput = outputs.find((port) => port.id === outputId)
    setConnectedInput(inputId || null)
    setConnectedOutput(outputId || null)
    setInputName(statusInput?.name ?? null)
    setOutputName(statusOutput?.name ?? null)
    setNotice(null)
  }

  async function disconnect(): Promise<void> {
    stopDevicePlay()
    await bridge.disconnect()
    setConnectedInput(null)
    setConnectedOutput(null)
    setInputName(null)
    setOutputName(null)
  }

  function editParameter(nextTarget: Target, parameterId: string, value: number, immediate: boolean): void {
    const key = targetKey(nextTarget, parameterId)
    setValues((current) => ({ ...current, [key]: { value, status: immediate ? current[key]?.status ?? 'local' : 'local' } }))
    void bridge.sendParameter(nextTarget, parameterId, value, immediate).then((result) => {
      if (!result.ok) {
        setNotice(result.reason)
        return
      }
      if (result.status === 'queued') return
      setValues((current) => {
        const existing = current[key]
        if (!existing || existing.value !== value) return current
        return { ...current, [key]: { value, status: result.status === 'observed' ? 'observed' : 'sent' } }
      })
    })
  }

  async function choosePattern(index: number): Promise<void> {
    const result = await bridge.sendProgram(index)
    setNotice(result.ok ? result.detail : result.reason)
    const label = patternLabel(index)
    setPatternCue(result.ok ? (devicePlayRef.current ? `${label} at pattern end` : label) : result.reason)
    window.clearTimeout(patternCueTimer.current)
    patternCueTimer.current = window.setTimeout(() => setPatternCue(''), 1800)
    if (result.ok) setPattern(index)
  }
  choosePatternRef.current = (index) => {
    void choosePattern(index)
  }

  function rememberMutes(flags: boolean[]): void {
    mutedRef.current = flags
    setMuted(flags)
  }

  const toggleTrackMute = useCallback((index: number): void => {
    const previous = mutedRef.current
    const next = toggleMuteFlags(previous, index, channelsRef.current)
    const value = next[index] ? MUTE_ON : MUTE_OFF
    rememberMutes(next)
    void bridge.sendParameter({ kind: 'track', index }, 'mute', value, true).then((result) => {
      if (!result.ok) {
        rememberMutes(previous)
        setNotice(result.reason)
        return
      }
      setSoloed(null)
      setNotice(value === MUTE_ON ? `Muted track ${index + 1}.` : `Unmuted track ${index + 1}.`)
      setValues((current) => {
        const updated = { ...current }
        const channel = channelsRef.current.tracks[index]
        channelsRef.current.tracks.forEach((trackChannel, track) => {
          if (trackChannel !== channel) return
          updated[targetKey({ kind: 'track', index: track }, 'mute')] = {
            value,
            status: result.status === 'observed' ? 'observed' : 'sent'
          }
        })
        return updated
      })
    })
  }, [bridge])

  async function solo(index: number): Promise<void> {
    const next = soloed === index ? null : index
    const result = await bridge.solo(next)
    setNotice(result.ok ? result.detail : result.reason)
    if (!result.ok) return
    setSoloed(next)
    const levels = soloLevels(next, channelsRef.current)
    rememberMutes(levels.map((item) => item.value === MUTE_ON))
    setValues((current) => {
      const updated = { ...current }
      for (const item of levels) {
        updated[targetKey({ kind: 'track', index: item.index }, 'mute')] = { value: item.value, status: 'sent' }
      }
      return updated
    })
  }

  async function panic(): Promise<void> {
    if (!panicArmed) {
      setPanicArmed(true)
      window.setTimeout(() => setPanicArmed(false), 2500)
      return
    }
    setPanicArmed(false)
    haltDeviceClock()
    noteDuckClock(duckRef.current, 'stop', performance.now(), 'app')
    const result = await bridge.panic()
    setNotice(result.ok ? result.detail : result.reason)
  }

  async function loopback(): Promise<void> {
    const result = await bridge.loopback()
    setNotice(result.detail)
  }

  const outputConnected = connectedOutput != null
  const outputPort = outputs.find((port) => port.id === connectedOutput)
  const sendingToCycles = outputPort != null && !outputPort.simulated && looksLikeModelCycles(outputPort.name)
  const sendingToSimulator = connectedOutput === 'sim:output'
  const cyclesPresent = outputs.some((port) => !port.simulated && looksLikeModelCycles(port.name))
  const listeningToCycles = inputName != null && looksLikeModelCycles(inputName)
  const warnings = sharedChannelWarnings(channels.tracks)
  const groups = target.kind === 'fx' ? FX_GROUPS : TRACK_GROUPS
  const selectedName = target.kind === 'fx' ? 'FX' : TRACKS[target.index].name
  const panel = target.kind === 'track' ? panels[target.index] : null
  const sampler = panel?.machine === 'sampler'

  return (
    <div
      className={filled ? 'app is-visual is-filled' : view === 'visual' ? 'app is-visual' : 'app is-editor'}
      style={{
        gridTemplateRows: filled ? 'minmax(0, 1fr)' : view === 'visual' ? '64px minmax(0, 1fr)' : `64px minmax(0, 1fr) 8px ${monitorHeight}px`
      }}
    >
      {!filled && <header className="topbar">
        <div className="brand">
          <button
            type="button"
            className="brand-mark"
            aria-pressed={appearance === 'light'}
            aria-label={appearance === 'light' ? 'Dark mode' : 'Light mode'}
            onClick={() => setAppearance((current) => (current === 'light' ? 'dark' : 'light'))}
          />
          <div>
            <strong>Model:Colors</strong>
            <span>OS {protocol.firmware}</span>
          </div>
        </div>
        <div className="transport">
          <label className="tempo">
            Tempo
            <input
              type="number"
              min={40}
              max={240}
              value={tempo}
              onChange={(event) => setTempo(Math.max(40, Math.min(240, Number(event.target.value) || 120)))}
            />
          </label>
          <button
            type="button"
            className={view === 'visual' ? 'viz-toggle is-on' : 'viz-toggle'}
            onClick={() => setView((current) => (current === 'visual' ? 'editor' : 'visual'))}
          >
            {view === 'visual' ? 'Editor' : 'Visualizer'}
          </button>
          {view !== 'visual' && (
            <label className="tempo" title="Set this to the same channel as AUTO on the Model:Cycles. A common setting is 10.">
              AUTO
              <ChannelSelect
                allowEmpty
                value={channels.auto}
                onChange={(value) => setChannels((current) => ({ ...current, auto: value }))}
              />
            </label>
          )}
          {view !== 'visual' && (
            <div className="section-tabs" role="tablist" aria-label="Sections">
              <button type="button" role="tab" aria-selected={stage === 'record'} className={stage === 'record' ? 'is-on' : ''} onClick={() => setStage('record')}>
                Record
              </button>
              <button type="button" role="tab" aria-selected={stage === 'sound'} className={stage === 'sound' ? 'is-on' : ''} onClick={() => setStage('sound')}>
                Sound
              </button>
              <button type="button" role="tab" aria-selected={stage === 'setup'} className={stage === 'setup' ? 'is-on' : ''} onClick={() => setStage('setup')}>
                Setup
              </button>
            </div>
          )}
        </div>
        <div className="top-status">
          {view !== 'visual' && patternCue && <span className="pill is-on">{patternCue}</span>}
          <span className={sendingToCycles ? 'pill is-on' : outputConnected ? 'pill is-warn' : 'pill'}>
            {sendingToCycles ? 'Sending to Model:Cycles' : sendingToSimulator ? 'Simulator only' : outputConnected ? 'Wrong MIDI port' : 'Choose a port'}
          </span>
          {devicePlaying && <span className="pill is-on">Playing</span>}
          <button type="button" className={panicArmed ? 'panic is-armed' : 'panic'} onClick={() => void panic()}>
            {panicArmed ? 'Confirm panic' : 'Panic'}
          </button>
          <button
            type="button"
            className={insertsOpen ? 'viz-toggle is-on' : 'viz-toggle'}
            onClick={() => setInsertsOpen((current) => !current)}
          >
            Controls
          </button>
        </div>
      </header>}
      <Inserts
        open={insertsOpen && !filled}
        tempo={tempo}
        onClose={() => setInsertsOpen(false)}
        filterReset={filterReset}
        onFilterReset={setFilterReset}
        filterSlope={filterSlope}
        onFilterSlope={(slope) => {
          setFilterSlope(slope)
          void bridge.setOutputFilterShape(slope, filterResonance)
        }}
        filterResonance={filterResonance}
        onFilterResonance={(resonance) => {
          setFilterResonance(resonance)
          void bridge.setOutputFilterShape(filterSlope, resonance)
        }}
        onLooks={(slots: readonly InsertSlot[]) => {
          looksRef.current = slots.map((slot) => ({ on: slot.look, fadeBars: slot.fadeBars, fadeOutBars: slot.fadeOutBars }))
        }}
        duckQuantize={duckQuantize}
        onDuckQuantize={(on) => {
          setDuckQuantize(on)
          duckQuantizeRef.current = on
          if (!on) {
            duckWait.current = null
            duckRef.current.division = duckIntent.current.division
            duckRef.current.label = duckIntent.current.label
            duckRef.current.custom = duckIntent.current.custom
            publishDuckRef.current(true)
          }
        }}
        stutterQuantize={stutterQuantize}
        onStutterQuantize={(on) => {
          setStutterQuantize(on)
          stutterQuantizeRef.current = on
          if (!on) {
            stutterWait.current = null
            stutterRef.current.division = stutterIntent.current.division
            stutterRef.current.label = stutterIntent.current.label
            stutterRef.current.custom = stutterIntent.current.custom
            publishStutterRef.current(true)
          }
        }}
        reverseQuantize={reverseQuantize}
        onReverseQuantize={(on) => {
          setReverseQuantize(on)
          reverseQuantizeRef.current = on
          if (!on && motionWaitKind.current === 'reverse') {
            motionWait.current = null
            motionWaitKind.current = null
            motionRef.current.reverse = motionIntent.current.reverse
            motionRef.current.tape = motionIntent.current.tape
            publishMotionRef.current()
          }
        }}
        tapeQuantize={tapeQuantize}
        onTapeQuantize={(on) => {
          setTapeQuantize(on)
          tapeQuantizeRef.current = on
          if (!on && motionWaitKind.current === 'tape') {
            motionWait.current = null
            motionWaitKind.current = null
            motionRef.current.reverse = motionIntent.current.reverse
            motionRef.current.tape = motionIntent.current.tape
            publishMotionRef.current()
          }
        }}
        tapeSpeed={tapeSpeed}
        onTapeSpeed={(speed) => {
          setTapeSpeed(speed)
          tapeSpeedRef.current = speed
          publishMotionRef.current()
        }}
        onCaptureAdvanced={() => ({
          duckTrigs: duckRef.current.trigs,
          stutterTrigs: stutterRef.current.trigs,
          duckQuantize: duckQuantizeRef.current,
          stutterQuantize: stutterQuantizeRef.current,
          reverseQuantize: reverseQuantizeRef.current,
          reverseBars: reverseBarsRef.current,
          reverseOver: reverseOverRef.current,
          tapeQuantize: tapeQuantizeRef.current,
          tapeOver: tapeOverRef.current,
          tapeSpeed: tapeSpeedRef.current,
          filterReset,
          filterSlope,
          filterResonance
        })}
        onRestoreAdvanced={(next: ControlsAdvanced) => {
          duckWait.current = null
          stutterWait.current = null
          motionWait.current = null
          motionWaitKind.current = null
          duckRef.current.trigs = next.duckTrigs
          stutterRef.current.trigs = next.stutterTrigs
          setDuckTrigs(next.duckTrigs)
          setStutterTrigs(next.stutterTrigs)
          duckQuantizeRef.current = next.duckQuantize
          stutterQuantizeRef.current = next.stutterQuantize
          reverseQuantizeRef.current = next.reverseQuantize
          tapeQuantizeRef.current = next.tapeQuantize
          reverseBarsRef.current = next.reverseBars
          reverseOverRef.current = next.reverseOver
          tapeOverRef.current = next.tapeOver
          tapeSpeedRef.current = next.tapeSpeed
          setDuckQuantize(next.duckQuantize)
          setStutterQuantize(next.stutterQuantize)
          setReverseQuantize(next.reverseQuantize)
          setTapeQuantize(next.tapeQuantize)
          setReverseBars(next.reverseBars)
          setReverseOver(next.reverseOver)
          setTapeOver(next.tapeOver)
          setTapeSpeed(next.tapeSpeed)
          setFilterReset(next.filterReset)
          setFilterSlope(next.filterSlope)
          setFilterResonance(next.filterResonance)
          publishDuckRef.current(false)
          publishStutterRef.current(false)
          publishMotionRef.current()
          void bridge.setOutputFilterShape(next.filterSlope, next.filterResonance)
        }}
        onStatus={(message) => {
          if (message) setNotice(message)
        }}
        reverseBars={reverseBars}
        onReverseBars={(bars) => {
          setReverseBars(bars)
          reverseBarsRef.current = bars
          publishMotionRef.current()
        }}
        reverseOver={reverseOver}
        onReverseOver={(on) => {
          setReverseOver(on)
          reverseOverRef.current = on
          publishMotionRef.current()
        }}
        tapeOver={tapeOver}
        onTapeOver={(on) => {
          setTapeOver(on)
          tapeOverRef.current = on
          publishMotionRef.current()
        }}
        duckTrigs={duckTrigs}
        onDuckTrig={(index) => {
          const next = toggleDuckTrig(duckRef.current.trigs, index)
          duckRef.current.trigs = next
          setDuckTrigs(next)
          if (duckRef.current.custom) publishDuckRef.current(false)
        }}
        stutterTrigs={stutterTrigs}
        onStutterTrig={(index) => {
          const next = toggleStutterTrig(stutterRef.current.trigs, index)
          stutterRef.current.trigs = next
          setStutterTrigs(next)
          if (stutterRef.current.custom) publishStutterRef.current(false)
        }}
      />
      {view === 'visual' && (
        <Visualizer
          onFilled={setFilled}
          trackChannels={channels.tracks}
          muted={muted}
          onToggleMute={toggleTrackMute}
          tempo={tempo}
          duckRef={duckRef}
          stutterRef={stutterRef}
          motionRef={motionRef}
          tapeSpeedRef={tapeSpeedRef}
          filterReset={filterReset}
          looksRef={looksRef}
          holdRef={holdRef}
          appearance={appearance}
          patternCue={patternCue}
        />
      )}

      {view === 'editor' && (
      <>
      <div className={stage === 'setup' ? 'workspace is-setup' : 'workspace'}>
        <aside className="tracks">
          <h2>Tracks</h2>
          {TRACKS.map((track, index) => (
            <div key={track.name} className="track-row">
              <button
                type="button"
                className={target.kind === 'track' && target.index === index ? 'track is-selected' : 'track'}
                onClick={() => setTarget({ kind: 'track', index })}
              >
                <span className={`swatch swatch-${index + 1}`} />
                <span>
                  <strong>{track.name}</strong>
                  <small>Channel {channels.tracks[index]}</small>
                </span>
              </button>
              <button type="button" className={soloed === index ? 'solo is-on' : 'solo'} onClick={() => void solo(index)}>
                {soloed === index ? 'Soloed' : 'Solo'}
              </button>
            </div>
          ))}
          <button
            type="button"
            className={target.kind === 'fx' ? 'track is-selected' : 'track'}
            onClick={() => setTarget({ kind: 'fx' })}
          >
            <span className="swatch swatch-fx" />
            <span>
              <strong>FX</strong>
              <small>{channels.fx == null ? 'Channel not set' : `Channel ${channels.fx}`}</small>
            </span>
          </button>
        </aside>

        <main className={stage === 'record' ? 'stage' : 'connection'}>
          <div hidden={stage !== 'record'}>
            <RecordPanel />
          </div>
          {stage === 'sound' && (
            <Performance
              channels={channels}
              values={values}
              outputConnected={outputConnected}
              soloed={soloed}
              pattern={pattern}
              panels={panels}
              onProgramChannel={(value) => setChannels((current) => ({ ...current, program: value }))}
              onFxChannel={(value) => setChannels((current) => ({ ...current, fx: value }))}
              onPattern={(index) => void choosePattern(index)}
              onSolo={(index) => void solo(index)}
              onEdit={editParameter}
            />
          )}
          {stage === 'setup' && (
            <>
          <div className="panel-head">
            <h2>Connection</h2>
            <button type="button" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          <div className="port-row">
            <label>
              Input
              <select value={inputId} onChange={(event) => setInputId(event.target.value)}>
                <option value="">None</option>
                {inputs.map((port) => (
                  <option key={port.id} value={port.id}>
                    {port.likely ? '● ' : ''}
                    {port.name}
                    {port.simulated ? ' (simulator)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Output
              <select value={outputId} onChange={(event) => setOutputId(event.target.value)}>
                <option value="">None</option>
                {outputs.map((port) => (
                  <option key={port.id} value={port.id}>
                    {port.likely ? '● ' : ''}
                    {port.name}
                    {port.simulated ? ' (simulator)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="action-row">
            <button type="button" className="primary" onClick={() => void connect()}>
              Connect
            </button>
            <button type="button" onClick={() => void disconnect()} disabled={!connectedInput && !connectedOutput}>
              Disconnect
            </button>
            <button type="button" onClick={() => void loopback()} disabled={!outputConnected}>
              Loopback test
            </button>
          </div>
          <p className="status-line">
            {sendingToCycles &&
              `Sending knobs to ${outputName}${inputName ? `, listening on ${inputName}` : ''}. The Focusrite still plays the speaker audio.`}
            {sendingToSimulator &&
              'Open on the simulator. Choose Elektron Model:Cycles and press Connect to change the instrument.'}
            {outputConnected && !sendingToCycles && !sendingToSimulator && cyclesPresent &&
              `Open on ${outputName}. Choose Elektron Model:Cycles and press Connect to change the instrument.`}
            {outputConnected && !sendingToCycles && !sendingToSimulator && !cyclesPresent &&
              `Open on ${outputName}. Plug the Model:Cycles in over USB so its MIDI port appears.`}
            {!outputConnected && 'No ports open. Nothing is being sent.'}
          </p>
          <p className="help">
            Output is the MIDI port the knobs talk to. Elektron Model:Cycles is the instrument. Focusrite USB MIDI is the interface's MIDI jack, and the speakers stay on the Focusrite either way.
          </p>
          {listeningToCycles && (
            <p className="help">
              Turn a knob on the Model:Cycles and the matching dial moves to that position. Opening the port does not read the positions already stored on the instrument. On the instrument, turn MOUT on for each track with FUNC + TRACK, set CONFIG › MIDI › FILTER › ENCS to I+E, and include USB in OUT TO.
            </p>
          )}
          {nativeError && <p className="warn">{nativeError}</p>}
          <label className="echo">
            <input
              type="checkbox"
              checked={echo}
              onChange={(event) => {
                setEcho(event.target.checked)
                void bridge.setEcho(event.target.checked)
              }}
            />
            Simulator echoes controls, so a knob can show Observed. A Model:Cycles does not echo a received control.
          </label>

          <h2 className="section">Channels</h2>
          <p className="help">
            Track channels 1–6 are the manual’s defaults. AUTO starts at 10, the channel a Model:Cycles usually uses. FX and program channels stay unset. Changing these does not reconfigure the device.
          </p>
          <div className="channel-grid">
            {TRACKS.map((track, index) => (
              <label key={track.name}>
                {track.name}
                <ChannelSelect
                  value={channels.tracks[index]}
                  onChange={(value) =>
                    setChannels((current) => {
                      const tracks = [...current.tracks] as ChannelSetup['tracks']
                      tracks[index] = value ?? 1
                      return { ...current, tracks }
                    })
                  }
                />
              </label>
            ))}
            <label>
              FX
              <ChannelSelect
                allowEmpty
                value={channels.fx}
                onChange={(value) => setChannels((current) => ({ ...current, fx: value }))}
              />
            </label>
            <label>
              AUTO
              <ChannelSelect
                allowEmpty
                value={channels.auto}
                onChange={(value) => setChannels((current) => ({ ...current, auto: value }))}
              />
            </label>
            <label>
              Program
              <ChannelSelect
                allowEmpty
                value={channels.program}
                onChange={(value) => setChannels((current) => ({ ...current, program: value }))}
              />
            </label>
          </div>
          {warnings.map((warning) => (
            <p key={warning} className="warn">
              {warning}
            </p>
          ))}
          {notice && <p className="notice">{notice}</p>}
          <p className="help last-help">
            Panic sends All Notes Off and MIDI Stop on the track channels{channels.fx ? ', the FX channel' : ''}{channels.auto ? ', and AUTO' : ''}. It does not clear a pattern. Loopback sends a non-Elektron probe; the instrument should ignore it.
          </p>
            </>
          )}
        </main>

        <aside className="parameters">
          <div className="panel-head">
            <h2>{selectedName} parameters</h2>
            <span className="raw-note">Raw MIDI 0–127</span>
          </div>
          <div className="rack">
            {panel && (
              <section className="tg-card">
                <h3>Model-TG</h3>
                <div className="tg-row">
                  <label>
                    Machine on this track
                    <select
                      value={panel.machine}
                      onChange={(event) =>
                        setPanels((current) =>
                          current.map((item, index) =>
                            index === (target.kind === 'track' ? target.index : -1)
                              ? { ...item, machine: event.target.value }
                              : item
                          )
                        )
                      }
                    >
                      {modelTg.machines.map((machine) => (
                        <option key={machine.id} value={machine.id}>
                          {machine.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {sampler && (
                    <label>
                      Playback mode
                      <select
                        value={panel.samplerMode}
                        onChange={(event) =>
                          setPanels((current) =>
                            current.map((item, index) =>
                              index === (target.kind === 'track' ? target.index : -1)
                                ? { ...item, samplerMode: event.target.value }
                                : item
                            )
                          )
                        }
                      >
                        {modelTg.samplerModes.map((mode) => (
                          <option key={mode.id} value={mode.id}>
                            {mode.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <p className="help">These menus only rename knobs. Nothing in this box is sent.</p>
                <ul>
                  {modelTg.panelOnly.map((item) => (
                    <li key={item.name}>
                      <strong>{item.name}.</strong> {item.panel}. {item.detail}
                    </li>
                  ))}
                </ul>
                <p className="help">On the instrument only: {modelTg.noMidi.join(', ')}.</p>
              </section>
            )}
            {groups.map((group) => (
              <section key={group.title}>
                <h3>{group.title}</h3>
                <div className="knob-grid">
                  {group.ids.map((id) => {
                    const parameter = parameterById(id)
                    if (!parameter) return null
                    const state = values[targetKey(target, id)]
                    const dial = sampler && panel ? samplerDialName(panel.samplerMode, id) : null
                    let caption = sampler && panel ? samplerKnobCaption(parameter, panel.samplerMode) : valueCaption(parameter)
                    if (id === 'machine') {
                      caption += ' · The machine menu above does not send this. The CC value for Sampler is unpublished.'
                    }
                    return (
                      <Knob
                        key={id}
                        name={dial ?? parameter.name}
                        value={state?.value ?? null}
                        status={state?.status ?? null}
                        caption={caption}
                        disabled={!outputConnected || (target.kind === 'fx' && channels.fx == null)}
                        onChange={(value, immediate) => editParameter(target, id, value, immediate)}
                      />
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </aside>
      </div>

      <div
        className={draggingMonitor ? 'divider is-dragging' : 'divider'}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize MIDI monitor"
        onPointerDown={(event) => {
          const startY = event.clientY
          const startHeight = monitorHeight
          setDraggingMonitor(true)
          const move = (ev: PointerEvent) => {
            setMonitorHeight(Math.min(420, Math.max(96, startHeight - (ev.clientY - startY))))
          }
          const up = () => {
            setDraggingMonitor(false)
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      />

      <section className="monitor" aria-label="MIDI monitor">
        <div className="panel-head">
          <h2>MIDI monitor</h2>
          <button type="button" onClick={() => setMonitor([])}>
            Clear
          </button>
        </div>
        <ol>
          {monitor.length === 0 && <li className="empty">Outgoing and incoming messages appear here.</li>}
          {monitor.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className={entry.direction === 'out' ? 'is-out' : 'is-in'}>
              <span>{entry.direction === 'out' ? 'OUT' : 'IN'}</span>
              {entry.text}
            </li>
          ))}
        </ol>
      </section>
      </>
      )}
    </div>
  )
}

function ChannelSelect({
  value,
  allowEmpty = false,
  onChange
}: {
  value: number | null
  allowEmpty?: boolean
  onChange: (value: number | null) => void
}) {
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}>
      {allowEmpty && <option value="">Not set</option>}
      {Array.from({ length: 16 }, (_, index) => (
        <option key={index + 1} value={index + 1}>
          {index + 1}
        </option>
      ))}
    </select>
  )
}
