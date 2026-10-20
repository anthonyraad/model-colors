import { useEffect, useRef, useState } from 'react'

type KnobProps = {
  name: string
  value: number | null
  status: 'local' | 'sent' | 'observed' | null
  caption: string
  disabled: boolean
  compact?: boolean
  onChange: (value: number, immediate: boolean) => void
}

function clamp(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)))
}

export function Knob({ name, value, status, caption, disabled, compact = false, onChange }: KnobProps) {
  const dial = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ y: number; value: number; moved: boolean } | null>(null)
  const latest = useRef<number | null>(value)
  if (!drag.current) latest.current = value
  const [typing, setTyping] = useState<string | null>(null)

  useEffect(() => {
    const node = dial.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (disabled) return
      event.preventDefault()
      const next = clamp((latest.current ?? 64) + (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 1 : 1))
      latest.current = next
      onChange(next, true)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [disabled, onChange])

  function commit(text: string): void {
    setTyping(null)
    if (text.trim() === '' || !Number.isFinite(Number(text))) return
    const next = clamp(Number(text))
    if (next === latest.current) return
    latest.current = next
    onChange(next, true)
  }

  const statusLabel = status === 'observed' ? 'Observed' : status === 'sent' ? 'Sent' : status === 'local' ? 'Local' : 'Not sent'

  return (
    <div className={`knob ${compact ? 'is-compact' : ''} ${disabled ? 'is-disabled' : ''} ${status ? `is-${status}` : ''}`} title={caption}>
      <button
        ref={dial}
        type="button"
        className="knob-dial"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={127}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value == null ? 'not sent' : `${value}, ${statusLabel}`}
        disabled={disabled}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { y: event.clientY, value: value ?? 64, moved: false }
        }}
        onPointerMove={(event) => {
          const current = drag.current
          if (!current) return
          current.moved = true
          const scale = event.shiftKey ? 0.12 : 0.42
          const next = clamp(current.value + (current.y - event.clientY) * scale)
          latest.current = next
          onChange(next, false)
        }}
        onPointerUp={() => {
          const current = drag.current
          drag.current = null
          if (current?.moved && latest.current != null) onChange(latest.current, true)
        }}
        onKeyDown={(event) => {
          const base = latest.current ?? value ?? 64
          const delta =
            event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : event.key === 'PageUp' ? 8 : event.key === 'PageDown' ? -8 : null
          if (delta == null) return
          event.preventDefault()
          event.stopPropagation()
          const next = clamp(base + delta)
          latest.current = next
          onChange(next, true)
        }}
      >
        <span className="knob-arc" style={{ ['--turn' as string]: String((value ?? 0) / 127) }} />
        <span className="knob-readout">{value ?? '—'}</span>
      </button>
      <span className="knob-name">{name}</span>
      <input
        className="knob-entry"
        aria-label={`${name} value`}
        inputMode="numeric"
        disabled={disabled}
        value={typing ?? (value == null ? '' : String(value))}
        placeholder="—"
        onFocus={(event) => {
          setTyping(value == null ? '' : String(value))
          event.currentTarget.select()
        }}
        onChange={(event) => setTyping(event.target.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit(event.currentTarget.value)
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') setTyping(null)
        }}
      />
      <span className="knob-status">{statusLabel}</span>
    </div>
  )
}
