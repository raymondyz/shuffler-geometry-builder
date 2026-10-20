import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import styles from './controls.module.css'

export interface MenuItem {
  label: string
  onSelect(): void
  disabled?: boolean
  /** Draw a divider above this item */
  divider?: boolean
}

/** A button that opens a short list of actions. Closes on selection, outside click or Escape. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={styles.menu}>
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label} <span aria-hidden="true">▾</span>
      </Button>
      {open && (
        <div role="menu" className={styles.menuList}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={[styles.menuItem, item.divider ? styles.menuDivider : ''].filter(Boolean).join(' ')}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
