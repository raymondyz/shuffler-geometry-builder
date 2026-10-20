import type { Span } from '../../core/generate/brief'
import { NumberField, type Quantity } from '../common/NumberField'
import { SegmentedControl } from '../common/SegmentedControl'
import styles from './generate.module.css'

type SpanMode = 'fixed' | 'range' | 'free'

interface SpanFieldProps {
  label: string
  /** null means free */
  value: Span | null
  onChange(value: Span | null): void
  /** Value to start from when switching away from free */
  fallback: Span
  allowFree?: boolean
  quantity?: Quantity
  min?: number
  title?: string
}

const modeOf = (v: Span | null): SpanMode => (v === null ? 'free' : v.min === v.max ? 'fixed' : 'range')

/** A dimension the generator may hold fixed, vary within a range, or leave free. */
export function SpanField({ label, value, onChange, fallback, allowFree = false, quantity = 'length', min = 0, title }: SpanFieldProps) {
  const mode = modeOf(value)
  const setMode = (next: SpanMode) => {
    if (next === mode) return
    const base = value ?? fallback
    if (next === 'free') onChange(null)
    else if (next === 'fixed') onChange({ min: base.min, max: base.min })
    else onChange(base.min === base.max ? { min: base.min, max: base.min + Math.max(1, Math.abs(base.min) * 0.25) } : base)
  }
  const options = [
    { value: 'fixed' as const, label: 'Fixed' },
    { value: 'range' as const, label: 'Range' },
    ...(allowFree ? [{ value: 'free' as const, label: 'Free' }] : []),
  ]
  return (
    <div className={styles.item} title={title}>
      <div className={styles.itemHead}>
        <span className={styles.itemLabel}>{label}</span>
        <div className={styles.small}>
          <SegmentedControl label={`${label}: fixed, range or free`} value={mode} onChange={setMode} options={options} />
        </div>
      </div>
      {value && mode === 'fixed' && (
        <NumberField label={`${label} value`} quantity={quantity} min={min} value={value.min} onChange={(v) => onChange({ min: v, max: v })} layout="stacked" className={styles.single} />
      )}
      {value && mode === 'range' && (
        <div className={styles.pair}>
          <NumberField label="From" layout="stacked" quantity={quantity} min={min} value={value.min} onChange={(v) => onChange({ min: v, max: Math.max(v, value.max) })} />
          <NumberField label="To" layout="stacked" quantity={quantity} min={min} value={value.max} onChange={(v) => onChange({ min: Math.min(v, value.min), max: v })} />
        </div>
      )}
    </div>
  )
}
