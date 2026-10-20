import { useCallback, type PointerEvent as ReactPointerEvent } from 'react'
import type { Vec2 } from '../../../core/math/vec2'
import { useDesignStore } from '../../../state/designStore'
import { useViewport } from '../../plot/viewportContext'

/**
 * Starts a pointer drag that reports world positions, at most once per animation frame.
 * The whole drag is one undo step.
 */
export function useWorldDrag() {
  const { toWorld } = useViewport()
  return useCallback(
    (e: ReactPointerEvent<Element>, onMove: (world: Vec2) => void) => {
      e.stopPropagation()
      e.preventDefault()
      const el = e.currentTarget
      const pointerId = e.pointerId
      el.setPointerCapture(pointerId)
      const { beginGesture, endGesture } = useDesignStore.getState()
      beginGesture()
      let frame = 0
      let latest: Vec2 | null = null
      const flush = () => {
        frame = 0
        if (latest) onMove(latest)
      }
      const move = (ev: Event) => {
        const pe = ev as PointerEvent
        if (pe.pointerId !== pointerId) return
        latest = toWorld(pe.clientX, pe.clientY)
        if (!frame) frame = requestAnimationFrame(flush)
      }
      const end = (ev: Event) => {
        if ((ev as PointerEvent).pointerId !== pointerId) return
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', end)
        el.removeEventListener('pointercancel', end)
        el.removeEventListener('lostpointercapture', end)
        cancelAnimationFrame(frame)
        flush()
        endGesture()
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', end)
      el.addEventListener('pointercancel', end)
      el.addEventListener('lostpointercapture', end)
    },
    [toWorld],
  )
}
