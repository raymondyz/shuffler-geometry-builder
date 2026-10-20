import type { ReactNode } from 'react'
import styles from './layout.module.css'

interface PanelProps {
  /** Header content: a title or tabs */
  header: ReactNode
  /** Controls on the right side of the header */
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/** Framed card that hosts one view: header row plus a body that fills the remaining space. */
export function Panel({ header, actions, children, className }: PanelProps) {
  return (
    <div className={[styles.panel, className].filter(Boolean).join(' ')}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>{header}</div>
        {actions && <div className={styles.panelActions}>{actions}</div>}
      </div>
      <div className={styles.panelBody}>{children}</div>
    </div>
  )
}

/** Horizontal strip of controls inside a panel body. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className={styles.toolbar}>{children}</div>
}

/** Centered message shown when a view has nothing to draw. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>
}
