import type { ReactNode } from 'react'
import { InfoTip } from './InfoTip'
import styles from './controls.module.css'

interface CheckboxProps {
  label: ReactNode
  checked: boolean
  onChange(checked: boolean): void
  title?: string
  /** Explanation shown by an info icon after the label */
  info?: ReactNode
  /** Name for the info icon when the label isn't plain text */
  infoLabel?: string
}

export function Checkbox({ label, checked, onChange, title, info, infoLabel }: CheckboxProps) {
  const box = (
    <label className={styles.checkbox} title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
  if (!info) return box
  // The icon sits beside the label, not inside it, so clicking it never toggles the box
  return (
    <span className={styles.withInfo}>
      {box}
      <InfoTip label={infoLabel ?? (typeof label === 'string' ? label : 'this option')}>{info}</InfoTip>
    </span>
  )
}
