import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Knob } from './Knob'
import { samplerDialName, samplerKnobCaption } from '../midi/modelTg'
import { parameterById, valueCaption } from '../midi/protocol'
import { patternLabel, targetKey, type ChannelSetup, type Target } from '../midi/routing'

type ValueState = { value: number; status: 'local' | 'sent' | 'observed' }

const STRIP_IDS = ['trackLevel', 'pitch', 'decay', 'color', 'shape']
const PAD_IDS = ['trackLevel', 'pitch', 'decay', 'color', 'shape', 'sweep', 'contour', 'pan', 'delaySend', 'reverbSend']
const FX_IDS = ['delayTime', 'delayFeedback', 'reverbSize', 'reverbTone']
const BANKS = ['A', 'B', 'C', 'D', 'E', 'F']

type Axis = { track: number; parameterId: string }

export function Performance({
  channels,
  values,
  outputConnected,
  soloed,
  pattern,
  panels,
  onProgramChannel,
  onFxChannel,
  onPattern,
  onSolo,
  onEdit
}: {
  channels: ChannelSetup
  values: Record<string, ValueState>
  outputConnected: boolean
  soloed: number | null
  pattern: number | null
  panels: { machine: string; samplerMode: string }[]
  onProgramChannel: (channel: number | null) => void
  onFxChannel: (channel: number | null) => void
  onPattern: (index: number) => void
  onSolo: (index: number) => void
  onEdit: (target: Target, parameterId: string, value: number, immediate: boolean) => void
}) {
  const [bank, setBank] = useState(0)
  useEffect(() => {
    if (pattern != null) setBank(Math.floor(pattern / 16))
  }, [pattern])
  const [horizontal, setHorizontal] = useState<Axis>({ track: 0, parameterId: 'trackLevel' })
  const [vertical, setVertical] = useState<Axis>({ track: 1, parameterId: 'trackLevel' })
  const [pad, setPad] = useState({ x: 64, y: 64 })
  const surface = useRef<HTMLDivElement>(null)

  function movePad(event: ReactPointerEvent<HTMLDivElement>, immediate: boolean): void {
    if (!outputConnected) return
    const box = surface.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return
    const x = clamp(Math.round(((event.clientX - box.left) / box.width) * 127))
    const y = clamp(Math.round((1 - (event.clientY - box.top) / box.height) * 127))
    setPad({ x, y })
    onEdit({ kind: 'track', index: horizontal.track }, horizontal.parameterId, x, immediate)
    onEdit({ kind: 'track', index: vertical.track }, vertical.parameterId, y, immediate)
  }

  return (
    <section className="performance">
      <h2 className="section">Patterns</h2>
      <div className="pattern-head">
        <div className="bank-row">
          {BANKS.map((name, index) => (
            <button key={name} type="button" className={bank === index ? 'is-on' : ''} onClick={() => setBank(index)}>
              {name}
            </button>
          ))}
        </div>
        <label>
          Program channel
          <ChannelSelect allowEmpty value={channels.program} onChange={onProgramChannel} />
        </label>
      </div>
      <div className="pattern-grid">
        {Array.from({ length: 16 }, (_, slot) => {
          const index = bank * 16 + slot
          return (
            <button
              key={index}
              type="button"
              className={pattern === index ? 'is-on' : ''}
              disabled={!outputConnected || (channels.program == null && channels.auto == null)}
              onClick={() => onPattern(index)}
            >
              {patternLabel(index)}
            </button>
          )
        })}
      </div>
      <p className="help">
        Hold Shift and type a pattern from 1 to 16, then let go of Shift. It is sent on the Program channel, or on channel 10 when Program is empty. During playback the instrument waits until the pattern ends. This does not edit the pattern.
      </p>

      <h2 className="section">Tracks</h2>
      <div className="strips">
        {panels.map((panel, index) => (
          <div key={index} className="strip">
            <span className="strip-head">T{index + 1}</span>
            <button type="button" className={soloed === index ? 'solo is-on' : 'solo'} onClick={() => onSolo(index)}>
              {soloed === index ? 'Soloed' : 'Solo'}
            </button>
            {STRIP_IDS.map((id) => {
              const parameter = parameterById(id)
              if (!parameter) return null
              const dial = panel.machine === 'sampler' ? samplerDialName(panel.samplerMode, id) : null
              const state = values[targetKey({ kind: 'track', index }, id)]
              return (
                <Knob
                  key={id}
                  compact
                  name={dial ?? parameter.name}
                  value={state?.value ?? null}
                  status={state?.status ?? null}
                  caption={
                    panel.machine === 'sampler' ? samplerKnobCaption(parameter, panel.samplerMode) : valueCaption(parameter)
                  }
                  disabled={!outputConnected}
                  onChange={(value, immediate) => onEdit({ kind: 'track', index }, id, value, immediate)}
                />
              )
            })}
          </div>
        ))}
      </div>
      <p className="help">
        Solo sends Mute 0 on that track and Mute 127 on the others. The on/off threshold is unpublished. Click the lit Solo again to send Mute 0 on every track.
      </p>

      <h2 className="section">X-Y pad</h2>
      <div className="pad-setup">
        <AxisSelect label="Horizontal" axis={horizontal} onChange={setHorizontal} />
        <AxisSelect label="Vertical" axis={vertical} onChange={setVertical} />
      </div>
      <div
        ref={surface}
        className="xy-pad"
        role="application"
        aria-label="X-Y pad"
        onPointerDown={(event) => {
          if (!outputConnected) return
          event.currentTarget.setPointerCapture(event.pointerId)
          movePad(event, false)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          movePad(event, false)
        }}
        onPointerUp={(event) => movePad(event, true)}
      >
        <span className="xy-dot" style={{ left: `${(pad.x / 127) * 100}%`, bottom: `${(pad.y / 127) * 100}%` }} />
      </div>
      <p className="help">
        Horizontal moves the first control. Vertical moves the second. With both set to track level, drag toward a corner to favor one track.
      </p>

      <h2 className="section">FX</h2>
      <div className="fx-strip">
        <label>
          FX channel
          <ChannelSelect allowEmpty value={channels.fx} onChange={onFxChannel} />
        </label>
        {FX_IDS.map((id) => {
          const parameter = parameterById(id)
          if (!parameter) return null
          const state = values[targetKey({ kind: 'fx' }, id)]
          return (
            <Knob
              key={id}
              compact
              name={parameter.name}
              value={state?.value ?? null}
              status={state?.status ?? null}
              caption={valueCaption(parameter)}
              disabled={!outputConnected || channels.fx == null}
              onChange={(value, immediate) => onEdit({ kind: 'fx' }, id, value, immediate)}
            />
          )
        })}
      </div>
      <p className="help">Delay and reverb are on the FX channel. The manual does not print a factory FX channel, so set the same number the instrument uses.</p>
    </section>
  )
}

function AxisSelect({ label, axis, onChange }: { label: string; axis: Axis; onChange: (axis: Axis) => void }) {
  return (
    <label>
      {label}
      <select
        value={`${axis.track}:${axis.parameterId}`}
        onChange={(event) => {
          const [track, parameterId] = event.target.value.split(':')
          onChange({ track: Number(track), parameterId: parameterId ?? 'trackLevel' })
        }}
      >
        {Array.from({ length: 6 }, (_, track) =>
          PAD_IDS.map((id) => {
            const parameter = parameterById(id)
            return (
              <option key={`${track}:${id}`} value={`${track}:${id}`}>
                T{track + 1} {parameter?.name ?? id}
              </option>
            )
          })
        )}
      </select>
    </label>
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

function clamp(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)))
}
