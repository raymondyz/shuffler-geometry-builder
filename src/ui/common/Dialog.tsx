import { useEffect, useRef, type ReactNode } from 'react'
import styles from './controls.module.css'

interface DialogProps {
  title: string
  children: ReactNode
  /** Buttons; a `type="submit"` button triggers onSubmit */
  actions: ReactNode
  onSubmit(): void
  /** Called on Cancel, Escape or after submit */
  onClose(): void
  /** Extra class for the dialog box (e.g. a wider size) */
  className?: string
}

/** Modal dialog built on the native <dialog> element. Mount it to open it. */
export function Dialog({ title, children, actions, onSubmit, onClose, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog ref={ref} className={[styles.dialog, className].filter(Boolean).join(' ')} onClose={onClose} aria-label={title}>
      <form
        className={styles.dialogForm}
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <h2 className={styles.dialogTitle}>{title}</h2>
        {children}
        <div className={styles.dialogActions}>{actions}</div>
      </form>
    </dialog>
  )
}
