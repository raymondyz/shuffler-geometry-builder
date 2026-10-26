import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import styles from './controls.module.css'

export interface MenuItem {
  label: string
  onSelect(): void
  disabled?: boolean
  /** Draw a divider above this item */
  divider?: boolean
  icon?: IconName
  /** For a list of choices: marks the current one */
  checked?: boolean
}

interface MenuProps {
  /** Button text, or its accessible name when `icon` is given */
  label: string
  items: MenuItem[]
  /** Show this icon on the button instead of the label */
  icon?: IconName
  /** Open the list towards the left, for a button near the right edge */
  alignEnd?: boolean
}

/** A button that opens a short list of actions. Closes on selection, outside click or Escape. */
export function Menu({ label, items, icon, alignEnd = false }: MenuProps) {
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
      {/* An icon menu shows just the icon: it says what the menu is, and a caret would cost header width */}
      <Button
        icon={icon}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={icon ? label : undefined}
        title={icon ? label : undefined}
        onClick={() => setOpen(!open)}
      >
        {!icon && (
          <>
            {label} <span aria-hidden="true">▾</span>
          </>
        )}
      </Button>
      {open && (
        <div role="menu" className={[styles.menuList, alignEnd ? styles.menuEnd : ''].filter(Boolean).join(' ')}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked}
              className={[styles.menuItem, item.divider ? styles.menuDivider : ''].filter(Boolean).join(' ')}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.icon && <Icon name={item.icon} />}
              <span className={styles.menuLabel}>{item.label}</span>
              {item.checked && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
