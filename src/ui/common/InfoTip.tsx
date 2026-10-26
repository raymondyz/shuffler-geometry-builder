import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import styles from './controls.module.css'

const GAP = 6
const MARGIN = 8

interface InfoTipProps {
  /** What is being explained, for the button's accessible name ("About Bob") */
  label: string
  /** The explanation: a sentence or two */
  children: ReactNode
}

/**
 * A small ⓘ beside a term that explains it. It opens on hover (mouse), on keyboard focus, and on tap
 * or click (touch has no hover), so the explanation is always findable.
 */
export function InfoTip({ label, children }: InfoTipProps) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const tip = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const open = hover || focus || pinned

  const close = () => {
    setHover(false)
    setFocus(false)
    setPinned(false)
  }

  // A modal dialog sits in the top layer, so a tip inside one must render inside it to be seen
  useLayoutEffect(() => {
    setHost(open && button.current ? (button.current.closest('dialog') ?? document.body) : null)
  }, [open])

  /** Below the icon, or above it near the bottom of the window, and always inside the window */
  const place = useCallback(() => {
    if (!button.current || !tip.current) return
    const a = button.current.getBoundingClientRect()
    const w = tip.current.offsetWidth
    const h = tip.current.offsetHeight
    const left = Math.max(MARGIN, Math.min(window.innerWidth - MARGIN - w, a.left + a.width / 2 - w / 2))
    const below = a.bottom + GAP
    const top = below + h > window.innerHeight - MARGIN ? Math.max(MARGIN, a.top - GAP - h) : below
    setPos({ left, top })
  }, [])

  // Placed before paint, so the tip never shows at a stale position
  useLayoutEffect(() => {
    if (open && host) place()
  }, [open, host, children, place])

  // While open: Escape closes it (without closing a dialog behind it), tapping elsewhere unpins it, and
  // scrolling or resizing moves it with its icon
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    const onPointer = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node)) setPinned(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  return (
    <>
      <button
        ref={button}
        type="button"
        className={styles.info}
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        data-open={open || undefined}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
        onFocus={(e) => setFocus(e.currentTarget.matches(':focus-visible'))}
        onBlur={() => {
          setFocus(false)
          setPinned(false)
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setPinned((p) => !p)
        }}
      >
        <Icon name="info" size={14} />
      </button>
      {host &&
        createPortal(
          <span
            ref={tip}
            id={id}
            role="tooltip"
            className={styles.tip}
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
          >
            {children}
          </span>,
          host,
        )}
    </>
  )
}
