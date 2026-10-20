import { useId, useState, type KeyboardEvent } from 'react'
import { degToRad, radToDeg } from '../../core/math/angle'
import { useUnits } from '../../state/uiStore'
import { formatNumber, fromDisplay, lengthDecimals, lengthStep, toDisplay, type Units } from '../format'
import styles from './controls.module.css'

/** What a value measures: lengths follow the mm/in toggle, angles show degrees, plain values are shown as-is. */
export type Quantity = 'length' | 'angle' | 'plain'

export interface NumberFieldProps {
  label: string
  /** Value in internal units (mm, radians, or plain) */
  value: number
  onChange(value: number): void
  quantity?: Quantity
  /** Limits in internal units */
  min?: number
  max?: number
  integer?: boolean
  /** Unit text for plain quantities, e.g. "rpm" */
  suffix?: string
  /** Optional slider range in internal units */
  slider?: { min: number; max: number }
  title?: string
  disabled?: boolean
  className?: string
  /** Inline puts the label beside the input; stacked puts it above (compact rows) */
  layout?: 'inline' | 'stacked'
  /** Called around slider drags so the whole drag is one undo step */
  onGestureStart?(): void
  onGestureEnd?(): void
}

interface Converter {
  toShown(v: number): number
  fromShown(v: number): number
  decimals: number
  step: number
  suffix: string
}

function converterFor(quantity: Quantity, units: Units, integer: boolean, suffix: string): Converter {
  if (quantity === 'length') {
    return {
      toShown: (v) => toDisplay(v, units),
      fromShown: (v) => fromDisplay(v, units),
      decimals: lengthDecimals(units),
      step: toDisplay(lengthStep(units), units),
      suffix: units,
    }
  }
  if (quantity === 'angle') return { toShown: radToDeg, fromShown: degToRad, decimals: 1, step: 0.5, suffix: '°' }
  return { toShown: (v) => v, fromShown: (v) => v, decimals: integer ? 0 : 2, step: 1, suffix }
}

export function NumberField({
  label,
  value,
  onChange,
  quantity = 'plain',
  min = -Infinity,
  max = Infinity,
  integer = false,
  suffix = '',
  slider,
  title,
  disabled,
  className,
  layout = 'inline',
  onGestureStart,
  onGestureEnd,
}: NumberFieldProps) {
  const id = useId()
  const units = useUnits()
  const conv = converterFor(quantity, units, integer, suffix)
  const shown = formatNumber(conv.toShown(value), conv.decimals)
  const [draft, setDraft] = useState<string | null>(null)

  const clampValue = (v: number) => {
    const clamped = Math.min(max, Math.max(min, v))
    return integer ? Math.round(clamped) : clamped
  }

  const commit = (text: string) => {
    const parsed = Number.parseFloat(text)
    setDraft(null)
    if (!Number.isFinite(parsed)) return
    const next = clampValue(conv.fromShown(parsed))
    if (next !== value) onChange(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit(e.currentTarget.value)
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      setDraft(null)
      e.currentTarget.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const step = conv.step * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
      const next = clampValue(conv.fromShown(conv.toShown(value) + step))
      setDraft(null)
      if (next !== value) onChange(next)
    }
  }

  const startGesture = () => {
    if (!onGestureStart) return
    onGestureStart()
    const end = () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      onGestureEnd?.()
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  return (
    <div className={[styles.field, layout === 'stacked' ? styles.stacked : '', className].filter(Boolean).join(' ')} title={title}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.inputWrap}>
        <input
          id={id}
          className={styles.input}
          inputMode="decimal"
          value={draft ?? shown}
          disabled={disabled}
          onFocus={(e) => {
            setDraft(shown)
            e.currentTarget.select()
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        {conv.suffix && <span className={styles.suffix}>{conv.suffix}</span>}
      </div>
      {slider && (
        <input
          className={styles.slider}
          type="range"
          aria-label={`${label} slider`}
          min={slider.min}
          max={slider.max}
          step={integer ? 1 : (slider.max - slider.min) / 1000}
          value={Math.min(slider.max, Math.max(slider.min, value))}
          disabled={disabled}
          onPointerDown={startGesture}
          onChange={(e) => onChange(clampValue(Number(e.target.value)))}
        />
      )}
    </div>
  )
}
