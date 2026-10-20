import styles from './controls.module.css'

interface SelectProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange(value: T): void
  className?: string
}

export function Select<T extends string>({ label, value, options, onChange, className }: SelectProps<T>) {
  return (
    <select
      className={[styles.select, className].filter(Boolean).join(' ')}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
