import type { ReactNode } from 'react'
import styles from './controls.module.css'

interface CheckboxProps {
  label: ReactNode
  checked: boolean
  onChange(checked: boolean): void
  title?: string
}

export function Checkbox({ label, checked, onChange, title }: CheckboxProps) {
  return (
    <label className={styles.checkbox} title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
