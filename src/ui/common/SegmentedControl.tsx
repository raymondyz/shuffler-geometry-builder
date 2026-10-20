import styles from './controls.module.css'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  title?: string
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[]
  value: T | null
  onChange(value: T): void
  disabled?: boolean
  label: string
}

/** A row of mutually exclusive toggle buttons. `value = null` shows none selected. */
export function SegmentedControl<T extends string>({ options, value, onChange, disabled, label }: SegmentedControlProps<T>) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={styles.segment}
          aria-pressed={value === o.value}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
