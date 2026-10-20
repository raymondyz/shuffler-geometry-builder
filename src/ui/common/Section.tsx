import { useState, type ReactNode } from 'react'
import styles from './layout.module.css'

interface SectionProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  /** Extra content on the right of the header (e.g. a status count) */
  aside?: ReactNode
}

/** A titled, collapsible group in the sidebar. */
export function Section({ title, children, defaultOpen = true, aside }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={styles.section}>
      <button type="button" className={styles.sectionHeader} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={styles.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className={styles.sectionTitle}>{title}</span>
        {aside && <span className={styles.sectionAside}>{aside}</span>}
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  )
}
