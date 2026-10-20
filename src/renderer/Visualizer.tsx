import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  catchFilter,
  filterGesture,
  holdFilter,
  projectFilter,
  scheduleFilterReset,
  type FilterCatch,
  type FilterMove,
  type FilterResetBeats
} from '../audio/outputFilter'
import { customDuckGain, duckGain, duckPosition, type DuckState } from '../audio/duck'
import { customStutterGate, stutterGate, type StutterState } from '../audio/stutter'
import { motionLabel, tapeWindBeats, createTapePicture, stepTapePicture, type MotionState, type TapeSpeed } from '../audio/motion'
import { beginRecording, endRecording, recordingSnapshot, subscribeRecording } from './Record'
import { arrivingCyclesMediaId, isCyclesAudioName } from '../audio/capture'
import { getBridge } from '../midi/client'
import { INSERT_LOOK_SHORT, type LookGate } from '../audio/inserts'
import {
  createDirt,
  createTapeLook,
  grainAlpha,
  grainFlicker,
  highFrequency,
  stepLook,
  paintDirt,
  paintFlatSplit,
  paintHalation,
  stepDirt,
  paintLeaks,
  paintSplit,
  paintTapeFrame,
  paintVignette,
  stepTape,
  writeGrain,
  flatGrainCoat,
  flatGrainDensity,
  stutterPresence,
  type Highlight,
  type TapeLook
} from './visualizerLooks'
import {
  assignColors,
  audibleAmount,
  bandLevels,
  bandOnset,
  createColorHistory,
  createGroovePrint,
  createOrbs,
  createSequencerGrid,
  easeBreath,
  hearTransport,
  follow,
  hearClock,
  hearNote,
  historyCurrent,
  holdGroove,
  noticePatternChange,
  paletteForProgram,
  patternShuffle,
  randomSphereColors,
  redoColors,
  resetColorHistory,
  clusterHome,
  spectrumBins,
  orbPress,
  stepOrb,
  trackForNote,
  trackLevels,
  waveformPoints,
  waveformRms,
  type Appearance,
  type Orb
} from './visualizerMotion'

type Live = {
  lastClockAt: number
  beat: number
  wave: Uint8Array
  hearing: boolean
}

/**
 * Six tracks. The kick sits low and heavy, metal and hats travel a little
 * farther, and tone and chord sit between them. A hit grows and brightens
 * only that circle, then falls away the way a Cycles voice decays. A quiet
 * track stays a small dim ember.
 * The whole picture still breathes on the sequencer downbeat, and a late hat
 * stays late because the hop follows that track's own sound.
 * A new pattern changes the colors from the sound, the notes, or the pattern number.
 * Right arrow picks new colors, left arrow returns to the previous set,
 * and a pattern change on the instrument does the same.
 */
export const Visualizer = memo(function Visualizer({
  onFilled,
  trackChannels,
  muted,
  onToggleMute,
  tempo,
  duckRef,
  stutterRef,
  motionRef,
  tapeSpeedRef,
  filterReset,
  looksRef,
  holdRef,
  appearance,
  patternCue
}: {
  onFilled: (filled: boolean) => void
  trackChannels: readonly number[]
  muted: readonly boolean[]
  onToggleMute: (index: number) => void
  tempo: number
  duckRef: { current: DuckState }
  stutterRef: { current: StutterState }
  motionRef: { current: MotionState }
  tapeSpeedRef: { current: TapeSpeed }
  filterReset: FilterResetBeats
  looksRef: { current: readonly LookGate[] }
  holdRef: { current: { enabled: boolean } }
  appearance: Appearance
  patternCue: string
}) {
  const rootRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [full, setFull] = useState(false)
  const [caption, setCaption] = useState('')
  const recording = useSyncExternalStore(subscribeRecording, recordingSnapshot, recordingSnapshot)
  const captionRef = useRef(caption)
  const onFilledRef = useRef(onFilled)
  const channelsRef = useRef(trackChannels)
  const mutedRef = useRef(muted)
  const onToggleMuteRef = useRef(onToggleMute)
  const historyRef = useRef(createColorHistory())
  const paletteVersion = useRef(0)
  const appearanceRef = useRef(appearance)
  const groundTick = useRef(0)
  appearanceRef.current = appearance
  const grooveRef = useRef(createGroovePrint())
  const filterRef = useRef<FilterCatch>(holdFilter(0, 0))
  const resetBeatsRef = useRef(filterReset)
  resetBeatsRef.current = filterReset
  const gridRef = useRef(createSequencerGrid())
  const tempoRef = useRef(tempo)
  tempoRef.current = tempo
  onFilledRef.current = onFilled
  channelsRef.current = trackChannels
  mutedRef.current = muted
  onToggleMuteRef.current = onToggleMute

  useEffect(() => {
    resetColorHistory(historyRef.current, appearance)
    paletteVersion.current += 1
    groundTick.current += 1
  }, [appearance])

  useEffect(() => {
    const off = getBridge().onWindowFullscreen((enabled) => {
      setFull(enabled)
      onFilledRef.current(enabled)
    })
    const onChange = () => {
      if (window.cycles) return
      const enabled = document.fullscreenElement === rootRef.current
      setFull(enabled)
      onFilledRef.current(enabled)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      off()
      document.removeEventListener('fullscreenchange', onChange)
      onFilledRef.current(false)
      void getBridge().setFullscreen(false)
    }
  }, [])

  useEffect(() => {
    if (!full) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setFull(false)
      onFilledRef.current(false)
      void getBridge().setFullscreen(false)
      if (document.fullscreenElement) void document.exitFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code !== 'F1' && event.code !== 'F2') return
      event.preventDefault()
      if (event.code === 'F1') void beginRecording()
      else void endRecording()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let lastPattern: { program: number; at: number } | null = null
    const held = { up: false, down: false, right: false, rightMixed: false, last: 'hold' as Exclude<FilterMove, 'reset'> }
    const publish = (move: FilterMove) => {
      const parked = move === 'reset' ? 'hold' : move
      if (move !== 'reset' && parked === held.last) return
      held.last = parked
      filterRef.current = catchFilter(filterRef.current, move, performance.now())
      void getBridge().setOutputFilter(move)
    }
    const sync = () => publish(filterGesture(held))
    const typing = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (typing(event)) return
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        if (event.repeat) return
        if (held.up || held.down || held.right || resetBeatsRef.current === 0) {
          publish('reset')
          sync()
          return
        }
        const now = performance.now()
        const place = duckPosition(duckRef.current, now, tempoRef.current)
        const scheduled = scheduleFilterReset(
          filterRef.current,
          now,
          resetBeatsRef.current,
          place.running ? place.beats : null,
          place.running ? place.bpm : tempoRef.current
        )
        held.last = 'hold'
        filterRef.current = scheduled
        if (scheduled.move === 'return') {
          void getBridge().setOutputFilter('return', {
            position: scheduled.returnFrom,
            wait: scheduled.returnWait,
            span: scheduled.returnSpan
          })
        } else {
          publish('reset')
        }
        return
      }
      const knob = (event.target as HTMLElement | null)?.closest('.knob')
      if (knob && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) return
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown' || event.code === 'ArrowRight') {
        event.preventDefault()
        if (event.repeat) return
        if (event.code === 'ArrowUp') {
          held.up = true
          if (held.right) held.rightMixed = true
        } else if (event.code === 'ArrowDown') {
          held.down = true
          if (held.right) held.rightMixed = true
        } else {
          held.rightMixed = held.up || held.down
          held.right = true
        }
        sync()
        return
      }
      if (event.repeat || event.shiftKey || event.getModifierState('Shift')) return
      if (event.key >= '1' && event.key <= '6') {
        event.preventDefault()
        onToggleMuteRef.current(Number(event.key) - 1)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'ArrowUp') held.up = false
      else if (event.code === 'ArrowDown') held.down = false
      else if (event.code === 'ArrowRight') {
        const colorTap = held.right && !held.rightMixed
        held.right = false
        held.rightMixed = false
        sync()
        if (colorTap) {
          redoColors(historyRef.current, randomSphereColors())
          paletteVersion.current += 1
        }
        return
      } else return
      sync()
    }
    const onBlur = () => {
      held.up = false
      held.down = false
      held.right = false
      held.rightMixed = false
      sync()
    }
    const offProgram = getBridge().onProgram((event) => {
      const now = performance.now()
      if (!patternShuffle(event.program, lastPattern, now)) return
      lastPattern = { program: event.program, at: now }
      redoColors(historyRef.current, paletteForProgram(event.program))
      holdGroove(grooveRef.current)
      paletteVersion.current += 1
    })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      offProgram()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const live: Live = {
      lastClockAt: 0,
      beat: 0,
      wave: new Uint8Array(180),
      hearing: false
    }
    const orbs = createOrbs()
    const bands = [0, 0, 0, 0, 0, 0]
    const rawBands = [0, 0, 0, 0, 0, 0]
    const midiEnv = [0, 0, 0, 0, 0, 0]
    const midiHit = [0, 0, 0, 0, 0, 0]
    let drive = 0
    let shownFilter = 0
    let appliedPalette = 0
    let lastFrame = performance.now()
    let sampleRate = 48000
    const offRealtime = getBridge().onRealtime((kind) => {
      const now = performance.now()
      hearTransport(gridRef.current, kind)
      if (kind === 'start' || kind === 'stop') {
        live.lastClockAt = kind === 'start' ? now : 0
        return
      }
      if (kind === 'clock') hearClock(grooveRef.current)
      live.lastClockAt = now
    })
    const offNote = getBridge().onNote((event) => {
      if (!event.on) return
      hearNote(grooveRef.current, event.note)
      const index = trackForNote(event.channel, channelsRef.current)
      if (index < 0) return
      midiHit[index] = Math.max(midiHit[index] ?? 0, event.velocity / 127)
      const struck = orbs[index]
      if (struck && index >= 4) struck.pitch = Math.max(-1, Math.min(1, (event.note - 60) / 24))
    })

    let audio: AudioContext | null = null
    const resumeAudio = () => void audio?.resume()
    window.addEventListener('pointerdown', resumeAudio)
    window.addEventListener('keydown', resumeAudio)
    let stream: MediaStream | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let analyser: AnalyserNode | null = null
    let freq = new Uint8Array(0)
    let time = new Uint8Array(0)
    let cancelled = false
    let attaching = false

    void attach()

    const scene = document.createElement('canvas')
    const sceneCtx = scene.getContext('2d', { alpha: false })
    const hold = document.createElement('canvas')
    const holdCtx = hold.getContext('2d', { alpha: false })
    const fringe = document.createElement('canvas')
    const fringeCtx = fringe.getContext('2d')
    const scratch = document.createElement('canvas')
    const scratchCtx = scratch.getContext('2d')
    const bloom = document.createElement('canvas')
    const bloomCtx = bloom.getContext('2d')
    const fx = document.createElement('canvas')
    const fxCtx = fx.getContext('2d', { alpha: false })
    const lookRise = Array.from({ length: 6 }, () => ({ on: false, at: 0, bars: 0, bpm: 120, from: 0 }))
    const grainTile = document.createElement('canvas')
    grainTile.width = 160
    grainTile.height = 160
    const grainCtx = grainTile.getContext('2d')
    const dirt = createDirt()
    let tape: TapeLook = createTapeLook()
    let grainSeed = 1
    let grainHold = -1
    const tapePicture = createTapePicture(performance.now())
    const noise = document.createElement('canvas')
    noise.width = 140
    noise.height = 140
    const noiseCtx = noise.getContext('2d')
    if (noiseCtx) {
      const dots = noiseCtx.createImageData(140, 140)
      for (let i = 0; i < dots.data.length; i += 4) {
        const shade = 80 + Math.random() * 140
        dots.data[i] = shade
        dots.data[i + 1] = shade * 0.92
        dots.data[i + 2] = shade * 0.8
        dots.data[i + 3] = 28 + Math.random() * 40
      }
      noiseCtx.putImageData(dots, 0, 0)
    }
    const grain = context.createPattern(noise, 'repeat')

    let alive = true
    let primed = false
    let paintedGround = -1
    let frame = 0
    let captionTimer = 0
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const wallNow = now
      const dt = Math.min(0.05, (wallNow - lastFrame) / 1000)
      lastFrame = wallNow
      const tapeRate = stepTapePicture(
        tapePicture,
        motionRef.current.tape,
        tapeWindBeats(tapeSpeedRef.current),
        tempoRef.current,
        dt,
        wallNow
      )
      const motionDt = dt * tapeRate
      const pictureNow = tapePicture.now
      if (resize(canvas)) primed = false
      const width = canvas.width
      const height = canvas.height
      const sample = readAudio(live, analyser, freq, time, sampleRate)
      if (tapeRate < 0.999) {
        for (let i = 0; i < live.wave.length; i += 1) {
          const samplePoint = live.wave[i] ?? 128
          live.wave[i] = 128 + (samplePoint - 128) * tapeRate
        }
      }
      const heard = (live.hearing ? audibleAmount(sample.rms, sample.mean) : 0) * tapeRate
      const projected = projectFilter(filterRef.current, now)
      if (filterRef.current.move === 'return' && projected.move === 'hold') filterRef.current = projected
      shownFilter =
        filterRef.current.move === 'return'
          ? projected.position
          : follow(shownFilter, projected.position, dt, 10, 10)
      const duck = duckRef.current
      const stutter = stutterRef.current
      const place = duckPosition(duck, pictureNow, tempoRef.current)
      const pump = duck.custom
        ? customDuckGain(place.beats, duck.trigs, place.bpm)
        : duck.division > 0
          ? duckGain(place.beats, duck.division, place.bpm)
          : 1
      const chop = stutter.custom
        ? customStutterGate(place.beats, stutter.trigs, place.bpm)
        : stutter.division > 0
          ? stutterGate(place.beats, stutter.division, place.bpm)
          : 1
      drive = follow(drive, heard, dt, 28, 4.2)
      let onsetSum = 0
      const onsets = [0, 0, 0, 0, 0, 0]
      const voiced = trackLevels(sample.bands)
      for (let i = 0; i < 6; i += 1) {
        const raw = heard < 0.015 ? 0 : (voiced[i] ?? 0)
        const drum = i <= 3
        onsets[i] = bandOnset(rawBands[i] ?? 0, raw)
        onsetSum += onsets[i] ?? 0
        rawBands[i] = raw
        bands[i] = follow(bands[i] ?? 0, raw * tapeRate, dt, drum ? 42 : 26, drum ? 16 : 6.5)
        midiEnv[i] = follow(midiEnv[i] ?? 0, (midiHit[i] ?? 0) * tapeRate, dt, 52, drum ? 14 : 6)
      }
      if (noticePatternChange(grooveRef.current, sample.detail, drive, dt)) {
        redoColors(historyRef.current, randomSphereColors())
        paletteVersion.current += 1
      }
      if (paletteVersion.current !== appliedPalette) {
        appliedPalette = paletteVersion.current
        assignColors(orbs, historyCurrent(historyRef.current))
      }
      if (onsetSum > 0.2 && drive > 0.08) live.beat = 1
      live.beat = Math.max(0, live.beat * Math.exp(-dt * 8))
      const breath = easeBreath(gridRef.current, dt)
      const clockLive = live.lastClockAt > 0 && now - live.lastClockAt < 500

      const picture = sceneCtx ?? context
      if (sceneCtx) fitCanvas(scene, width, height)
      if (groundTick.current !== paintedGround) {
        paintedGround = groundTick.current
        primed = false
      }
      const light = appearanceRef.current === 'light'
      picture.fillStyle = light ? '#cccccc' : primed ? 'rgba(14, 10, 8, 0.34)' : '#100c0a'
      primed = true
      picture.fillRect(0, 0, width, height)

      const tint = mixColor(orbs)
      const span = Math.min(width, height)
      if (!light) {
        const wash = picture.createRadialGradient(width * 0.5, height * 0.42, span * 0.02, width * 0.5, height * 0.42, span * 0.72)
        const room = clockLive ? breath * 0.24 : live.beat * 0.1
        const hitWash = clockLive ? live.beat * 0.04 : 0
        wash.addColorStop(0, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${0.04 + drive * 0.18 + room + hitWash})`)
        wash.addColorStop(0.6, 'rgba(28, 16, 12, 0.04)')
        wash.addColorStop(1, 'rgba(0, 0, 0, 0)')
        picture.fillStyle = wash
        picture.fillRect(0, 0, width, height)
      }

      const lookAmount = (index: number): number => {
        const slot = looksRef.current[index]
        const rise = lookRise[index]
        const on = slot?.on === true
        if (!rise) return on ? 1 : 0
        const bars = on ? (slot?.fadeBars ?? 0) : (slot?.fadeOutBars ?? 0)
        return stepLook(rise, on, bars, tempoRef.current, pictureNow)
      }
      const highlights: Highlight[] = []
      let hottest = 0
      for (let i = 0; i < 6; i += 1) {
        const orb = orbs[i]
        if (!orb) continue
        const silenced = mutedRef.current[i] === true
        const energy = silenced ? 0 : Math.max(bands[i] ?? 0, midiEnv[i] ?? 0)
        const hit = (silenced ? 0 : Math.max(onsets[i] ?? 0, midiHit[i] ?? 0)) * tapeRate
        if (energy > (bands[hottest] ?? 0)) hottest = i
        const radius = stepOrb(
          orb,
          i,
          motionDt,
          clusterHome(i, width, height, pictureNow, drive, breath),
          drive,
          energy,
          hit,
          span,
          pictureNow,
          width,
          height,
          breath
        )
        if (tapeRate < 0.999) {
          const coast = Math.exp(-dt * (1 - tapeRate) * 3.2)
          orb.vx *= coast
          orb.vy *= coast
          orb.punch *= Math.exp(-dt * (1 - tapeRate) * 7)
        }
        const highlight = paintOrb(
          picture,
          orb,
          radius,
          Math.min(1, energy + breath * 0.28),
          silenced,
          orbPress(orb.x, orb.y, radius, shownFilter, orb.punch, light ? 1.15 : 1),
          pump,
          chop,
          light
        )
        if (!silenced) highlights.push(highlight)
        midiHit[i] = 0
      }

      drawWave(picture, live.wave, width, height, drive, orbs[hottest] ?? orbs[0], light)

      if (picture !== context) context.drawImage(scene, 0, 0)

      const bloomAmt = lookAmount(1)
      if (bloomAmt > 0 && (light || bloomCtx)) {
        if (!light && bloomCtx) fitCanvas(bloom, Math.max(2, width >> 1), Math.max(2, height >> 1))
        context.save()
        context.globalAlpha = bloomAmt
        if (bloomCtx) paintHalation(context, bloomCtx, highlights, width, height, light)
        context.restore()
      }

      const leakAmt = lookAmount(5)
      if (leakAmt > 0) {
        context.save()
        context.globalAlpha = leakAmt
        paintLeaks(context, width, height, pictureNow, drive, light)
        context.restore()
      }

      const splitAmt = lookAmount(2)
      const tapeOn = looksRef.current[3]?.on === true
      const tapeAmt = lookAmount(3)
      if (tapeOn) {
        const transient = onsets.reduce((max, value) => Math.max(max, value), 0)
        tape = stepTape(tape, pictureNow, transient, Math.random(), width)
      } else tape = createTapeLook()
      if (light && splitAmt > 0) {
        context.save()
        context.globalAlpha = splitAmt
        paintFlatSplit(context, highlights, width, pictureNow)
        context.restore()
      }
      if ((splitAmt > 0 || tapeAmt > 0) && holdCtx && scratchCtx && fringeCtx && fxCtx) {
        fitCanvas(hold, width, height)
        fitCanvas(scratch, width, height)
        fitCanvas(fringe, width, height)
        fitCanvas(fx, width, height)
        if (!light && splitAmt > 0) {
          holdCtx.drawImage(canvas, 0, 0)
          paintSplit(fxCtx, hold, scratchCtx, fringeCtx, width, height, pictureNow, 0)
          cover(context, fx, splitAmt)
        }
        if (tapeAmt > 0) {
          holdCtx.drawImage(canvas, 0, 0)
          paintTapeFrame(fxCtx, hold, scratchCtx, width, height, pictureNow, tape, light)
          cover(context, fx, tapeAmt)
        }
      }

      const lensAmt = lookAmount(4)
      if (looksRef.current[4]?.on && !light) stepDirt(dirt, pictureNow, motionDt)
      if (lensAmt > 0) {
        context.save()
        context.globalAlpha = lensAmt
        paintVignette(context, width, height, pictureNow, light)
        if (!light) paintDirt(context, dirt, width, height, pictureNow, looksRef.current[1]?.on === true, light)
        context.restore()
      }

      const high = highFrequency(sample.bands)
      const grainAmt = lookAmount(0)
      if (grainAmt > 0 && grainCtx) {
        const grainTick = light ? Math.floor(pictureNow / 160) : -1
        if (!light || grainTick !== grainHold) {
          grainHold = grainTick
          grainSeed = (Math.imul(grainSeed, 1664525) + 1013904223) >>> 0
          writeGrain(grainCtx, high, grainSeed, light, light ? flatGrainDensity(drive, high) : 0.1)
        }
        const tile = context.createPattern(grainTile, 'repeat')
        if (tile) {
          const flicker = grainFlicker(grainSeed)
          const coat = light ? flatGrainCoat(Math.floor(pictureNow / 70)) : grainAlpha(high) * flicker
          context.save()
          context.globalCompositeOperation = 'source-over'
          context.globalAlpha = coat * grainAmt
          context.translate(-(grainSeed % 160), -((grainSeed >>> 8) % 160))
          context.fillStyle = tile
          context.fillRect(0, 0, width + 160, height + 160)
          if (!light && flicker > 1.05) {
            context.globalAlpha = 0.07 * grainAmt
            context.translate(73, -41)
            context.fillRect(0, 0, width + 240, height + 240)
          }
          context.restore()
        }
      } else if (grain && !light) {
        const drift = drive * 36 + 0.6
        context.save()
        context.globalAlpha = 0.1 + drive * 0.1
        context.translate(-((pictureNow / 1000) * drift) % 140, -((pictureNow / 1000) * drift * 0.55) % 140)
        context.fillStyle = grain
        context.fillRect(0, 0, width + 140, height + 140)
        context.restore()
      }

      if (alive && now - captionTimer > 250) {
        captionTimer = now
        const mutedNames = mutedRef.current.flatMap((on, index) => (on ? [String(index + 1)] : []))
        const muteLabel = mutedNames.length > 0 ? `Muted ${mutedNames.join(' ')}` : ''
        const duckLabel = duckRef.current.label ? `Duck ${duckRef.current.label}` : ''
        const stutterLabel = stutterRef.current.label ? `Stutter ${stutterRef.current.label}` : ''
        const motionText = motionLabel(motionRef.current)
        const lookLabel = INSERT_LOOK_SHORT.filter((_, index) => looksRef.current[index]?.on).join(' ')
        const holdLabel = holdRef.current.enabled ? 'Hold' : ''
        const nextCaption = [muteLabel, duckLabel, stutterLabel, motionText, lookLabel, holdLabel].filter((part) => part.length > 0).join(' · ')
        if (nextCaption !== captionRef.current) {
          captionRef.current = nextCaption
          setCaption(nextCaption)
        }
      }
    }
    frame = requestAnimationFrame(draw)

    const plainAudio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      latency: 0,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 }
    }

    async function attach(deviceId?: string): Promise<void> {
      if (attaching || cancelled || !navigator.mediaDevices?.getUserMedia) return
      attaching = true
      try {
        const next = deviceId
          ? await navigator.mediaDevices.getUserMedia({ audio: { ...plainAudio, deviceId: { exact: deviceId } } })
          : await openCyclesInput()
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop())
          return
        }
        stream?.getTracks().forEach((track) => track.stop())
        source?.disconnect()
        stream = next
        if (!audio) {
          audio = new AudioContext({ latencyHint: 'interactive' })
          analyser = audio.createAnalyser()
          analyser.fftSize = 2048
          analyser.smoothingTimeConstant = 0
          analyser.minDecibels = -84
          analyser.maxDecibels = -18
          sampleRate = audio.sampleRate
          freq = new Uint8Array(analyser.frequencyBinCount)
          time = new Uint8Array(analyser.fftSize)
        }
        void audio.resume()
        source = audio.createMediaStreamSource(stream)
        if (analyser) source.connect(analyser)
        live.hearing = true
      } catch {
        if (!stream) live.hearing = false
      } finally {
        attaching = false
      }
    }

    async function followCycles(): Promise<void> {
      if (!navigator.mediaDevices?.enumerateDevices) return
      const devices = await navigator.mediaDevices.enumerateDevices()
      const nextId = arrivingCyclesMediaId(devices, stream?.getAudioTracks()[0]?.getSettings().deviceId)
      if (!nextId) return
      await attach(nextId)
    }

    const onDevices = () => void followCycles()
    navigator.mediaDevices?.addEventListener('devicechange', onDevices)
    const deviceTimer = window.setInterval(() => void followCycles(), 1000)

    return () => {
      alive = false
      cancelled = true
      cancelAnimationFrame(frame)
      offRealtime()
      offNote()
      window.removeEventListener('pointerdown', resumeAudio)
      window.removeEventListener('keydown', resumeAudio)
      navigator.mediaDevices?.removeEventListener('devicechange', onDevices)
      window.clearInterval(deviceTimer)
      stream?.getTracks().forEach((track) => track.stop())
      void audio?.close()
    }
  }, [])

  return (
    <section className={full ? `visualizer is-filled${appearance === 'light' ? ' is-light' : ''}` : `visualizer${appearance === 'light' ? ' is-light' : ''}`} ref={rootRef} aria-label="Visualizer">
      <canvas ref={canvasRef} />
      <div className="viz-scan" />
      <div className="viz-vignette" />
      {patternCue.length > 0 && <span className="viz-pattern">{patternCue}</span>}
      {recording.phase !== 'idle' || recording.message.length > 0 ? (
        <div className="viz-record">
          {recording.phase === 'recording' && <span className="record-dot" aria-hidden="true" />}
          <span>{recording.phase === 'recording' ? 'Recording' : recording.phase === 'review' ? 'Recorded' : recording.message}</span>
        </div>
      ) : null}
      {!full && (
        <div className="viz-chrome">
          {caption.length > 0 && <span className="viz-caption">{caption}</span>}
          <button
            type="button"
            onClick={() => {
              setFull(true)
              void enterFull(rootRef.current, onFilledRef)
            }}
          >
            Full screen
          </button>
        </div>
      )}
    </section>
  )
})

async function enterFull(node: HTMLElement | null, onFilled: { current: (filled: boolean) => void }): Promise<void> {
  onFilled.current(true)
  if (window.cycles) {
    await getBridge().setFullscreen(true)
    return
  }
  if (!node) return
  try {
    await node.requestFullscreen()
  } catch {
    onFilled.current(true)
  }
}

async function openCyclesInput(): Promise<MediaStream> {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    latency: 0,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 }
  }
  let stream = await navigator.mediaDevices.getUserMedia({ audio })
  const devices = await navigator.mediaDevices.enumerateDevices()
  const inputs = devices.filter((device) => device.kind === 'audioinput')
  const cycles = inputs.find((device) => isCyclesAudioName(device.label))
  const current = stream.getAudioTracks()[0]?.getSettings().deviceId
  if (!cycles || cycles.deviceId === current) return stream
  stream.getTracks().forEach((track) => track.stop())
  return navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: cycles.deviceId } } })
}

function readAudio(
  live: Live,
  analyser: AnalyserNode | null,
  freq: Uint8Array,
  time: Uint8Array,
  sampleRate: number
): { rms: number; mean: number; bands: number[]; detail: number[] } {
  const silent = { rms: 0, mean: 0, bands: [0, 0, 0, 0, 0, 0], detail: Array.from({ length: 24 }, () => 0) }
  if (!analyser || freq.length === 0 || time.length === 0) return silent
  analyser.getByteFrequencyData(freq as Uint8Array<ArrayBuffer>)
  analyser.getByteTimeDomainData(time as Uint8Array<ArrayBuffer>)
  const bands = bandLevels(freq, sampleRate)
  const step = Math.max(1, Math.floor(time.length / live.wave.length))
  for (let i = 0; i < live.wave.length; i += 1) live.wave[i] = time[i * step] ?? 128
  const mean = bands.reduce((sum, value) => sum + value, 0) / bands.length
  return { rms: waveformRms(time), mean, bands, detail: spectrumBins(freq, sampleRate) }
}

/** Unity stays full size. The volume floor collapses the orb and knocks the glow down. */
function duckPresence(gain: number): { scale: number; alpha: number } {
  const level = Math.min(1, Math.max(0, gain))
  return {
    scale: 0.2 + 0.8 * Math.pow(level, 1.85),
    alpha: 0.12 + 0.88 * Math.pow(level, 2.15)
  }
}

function cover(dest: CanvasRenderingContext2D, source: HTMLCanvasElement, amount: number): void {
  dest.save()
  dest.globalCompositeOperation = 'source-over'
  dest.globalAlpha = amount
  dest.drawImage(source, 0, 0)
  dest.restore()
}

function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width === width && canvas.height === height) return
  canvas.width = width
  canvas.height = height
}

function paintOrb(
  context: CanvasRenderingContext2D,
  orb: Orb,
  radius: number,
  amount: number,
  muted = false,
  press: { x: number; y: number; scaleX: number; scaleY: number } = { x: orb.x, y: orb.y, scaleX: 1, scaleY: 1 },
  gain = 1,
  chop = 1,
  light = false
): Highlight {
  const [red, green, blue] = orb.color
  const presence = duckPresence(gain)
  const stutter = stutterPresence(chop, light)
  const drawn = radius * presence.scale * stutter.scale
  const fade = (muted ? 0.22 : 1) * presence.alpha * (light ? (stutter.shown ? 1 : 0) : Math.min(1, Math.max(0, chop)))
  if (light && !stutter.shown) {
    return { x: press.x, y: press.y, radius: 0, amount, punch: orb.punch, color: [red, green, blue] }
  }
  const core = (0.07 + Math.min(0.78, amount * 1.15 + orb.punch * 0.85)) * fade
  context.save()
  context.translate(press.x, press.y)
  context.scale(press.scaleX, press.scaleY)
  if (light) {
    context.globalAlpha = fade
    context.fillStyle = `rgb(${red}, ${green}, ${blue})`
  } else {
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, drawn)
    glow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${core})`)
    glow.addColorStop(0.28, `rgba(${red}, ${green}, ${blue}, ${(0.03 + Math.min(0.42, amount * 0.6 + orb.punch * 0.4)) * fade})`)
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = glow
  }
  context.beginPath()
  context.arc(0, 0, drawn, 0, Math.PI * 2)
  context.fill()
  context.restore()
  return { x: press.x, y: press.y, radius: drawn, amount, punch: orb.punch, color: [red, green, blue] }
}

function mixColor(orbs: Orb[]): [number, number, number] {
  const color: [number, number, number] = [0, 0, 0]
  for (const orb of orbs) {
    color[0] += orb.color[0]
    color[1] += orb.color[1]
    color[2] += orb.color[2]
  }
  const count = Math.max(1, orbs.length)
  return [Math.round(color[0] / count), Math.round(color[1] / count), Math.round(color[2] / count)]
}

function drawWave(
  context: CanvasRenderingContext2D,
  wave: Uint8Array,
  width: number,
  height: number,
  level: number,
  orb: Orb | undefined,
  light = false
): void {
  const shaped = waveformPoints(wave)
  const moving = shaped.some((sample) => Math.abs(sample) > 0.04)
  if (!moving) return
  const [red, green, blue] = orb?.color ?? [255, 220, 186]
  context.beginPath()
  context.lineWidth = light ? 5 : 2
  context.lineJoin = 'round'
  context.lineCap = 'round'
  context.strokeStyle = light ? '#141414' : `rgba(${red}, ${green}, ${blue}, ${0.35 + Math.min(0.55, level * 0.7)})`
  const mid = height * 0.84
  const room = Math.max(4, Math.min(mid - 6, height - mid - 6))
  const amp = Math.min(room, height * (0.045 + level * 0.05))
  for (let i = 0; i < shaped.length; i += 1) {
    const x = (i / Math.max(1, shaped.length - 1)) * width
    const y = mid + (shaped[i] ?? 0) * amp
    if (i === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.stroke()
}

function resize(canvas: HTMLCanvasElement): boolean {
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio))
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio))
  if (canvas.width === width && canvas.height === height) return false
  canvas.width = width
  canvas.height = height
  return true
}
