import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { Vec2 } from '../../core/math/vec2'
import { Button } from '../common/Button'
import { useElementSize, type Size } from '../hooks/useElementSize'
import styles from './plot.module.css'
import { useViewport, ViewportContext, type Bounds, type ViewportApi, type ViewTransform } from './viewportContext'

const PADDING = 28
const MIN_SCALE = 0.05
const MAX_SCALE = 400

function fitTransform(bounds: Bounds, size: Size): ViewTransform {
  const w = Math.max(1e-6, bounds.max.x - bounds.min.x)
  const h = Math.max(1e-6, bounds.max.y - bounds.min.y)
  const scale = Math.min((size.width - 2 * PADDING) / w, (size.height - 2 * PADDING) / h)
  const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
  const cx = (bounds.min.x + bounds.max.x) / 2
  const cy = (bounds.min.y + bounds.max.y) / 2
  return { scale: s, tx: size.width / 2 - cx * s, ty: size.height / 2 + cy * s }
}

function zoomAbout(t: ViewTransform, factor: number, at: Vec2): ViewTransform {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale * factor))
  const f = scale / t.scale
  return { scale, tx: at.x - (at.x - t.tx) * f, ty: at.y - (at.y - t.ty) * f }
}

function localPoint(svg: SVGSVGElement | null, clientX: number, clientY: number): Vec2 {
  const rect = svg?.getBoundingClientRect()
  return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
}

interface ViewportProps {
  /** Content extents used for the initial fit and the Fit button */
  bounds: Bounds
  /** World-space SVG content */
  children: ReactNode
  /** HTML drawn over the canvas (legends, readouts) */
  overlay?: ReactNode
  /** Click on empty canvas (not a drag), with its world position and the world size of one screen pixel */
  onBackgroundClick?(at: Vec2, px: number): void
  ariaLabel: string
}

interface Gesture {
  start: ViewTransform
  points: Map<number, Vec2>
  moved: boolean
}

/**
 * Pan/zoom canvas in world millimetres with y up. Drag the background to pan, wheel or pinch to zoom.
 * Interactive children stop pointerdown propagation to keep their own drags.
 */
export function Viewport({ bounds, children, overlay, onBackgroundClick, ariaLabel }: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<SVGSVGElement | null>(null)
  const size = useElementSize(containerRef)
  const [view, setView] = useState<ViewTransform | null>(null)
  const userMoved = useRef(false)
  const boundsRef = useRef(bounds)
  useLayoutEffect(() => {
    boundsRef.current = bounds
  }, [bounds])

  // Fit on first layout and on resize until the user pans or zooms
  useEffect(() => {
    if (size.width > 0 && size.height > 0 && !userMoved.current) setView(fitTransform(boundsRef.current, size))
  }, [size])

  const fit = useCallback(() => {
    userMoved.current = false
    setView(fitTransform(boundsRef.current, size))
  }, [size])

  // Wheel zoom needs a non-passive listener to prevent page scroll
  useEffect(() => {
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rate = e.deltaMode === 1 ? 0.05 : 0.0015
      const at = localPoint(svg, e.clientX, e.clientY)
      userMoved.current = true
      setView((t) => (t ? zoomAbout(t, Math.exp(-e.deltaY * rate), at) : t))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [svg])

  const pointers = useRef(new Map<number, Vec2>())
  const gesture = useRef<Gesture | null>(null)

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!view || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, localPoint(svg, e.clientX, e.clientY))
    gesture.current = { start: view, points: new Map(pointers.current), moved: gesture.current?.moved ?? false }
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, localPoint(svg, e.clientX, e.clientY))
    const ids = [...g.points.keys()].filter((id) => pointers.current.has(id))
    if (ids.length === 1) {
      const a0 = g.points.get(ids[0])!
      const a1 = pointers.current.get(ids[0])!
      if (Math.hypot(a1.x - a0.x, a1.y - a0.y) > 3) g.moved = true
      if (g.moved) setView({ ...g.start, tx: g.start.tx + a1.x - a0.x, ty: g.start.ty + a1.y - a0.y })
    } else if (ids.length >= 2) {
      const [p0, q0] = [g.points.get(ids[0])!, g.points.get(ids[1])!]
      const [p1, q1] = [pointers.current.get(ids[0])!, pointers.current.get(ids[1])!]
      const d0 = Math.hypot(q0.x - p0.x, q0.y - p0.y)
      const d1 = Math.hypot(q1.x - p1.x, q1.y - p1.y)
      const m0 = { x: (p0.x + q0.x) / 2, y: (p0.y + q0.y) / 2 }
      const m1 = { x: (p1.x + q1.x) / 2, y: (p1.y + q1.y) / 2 }
      g.moved = true
      const zoomed = zoomAbout(g.start, d0 > 0 ? d1 / d0 : 1, m0)
      setView({ ...zoomed, tx: zoomed.tx + m1.x - m0.x, ty: zoomed.ty + m1.y - m0.y })
    }
    if (g.moved) userMoved.current = true
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      if (g && !g.moved && view) {
        const p = localPoint(svg, e.clientX, e.clientY)
        onBackgroundClick?.({ x: (p.x - view.tx) / view.scale, y: -(p.y - view.ty) / view.scale }, 1 / view.scale)
      }
      gesture.current = null
    } else if (view) {
      gesture.current = { start: view, points: new Map(pointers.current), moved: true }
    }
  }

  const api = useMemo<ViewportApi | null>(() => {
    if (!view) return null
    return {
      transform: view,
      visible: {
        min: { x: -view.tx / view.scale, y: (view.ty - size.height) / view.scale },
        max: { x: (size.width - view.tx) / view.scale, y: view.ty / view.scale },
      },
      toWorld(clientX, clientY) {
        const p = localPoint(svg, clientX, clientY)
        return { x: (p.x - view.tx) / view.scale, y: -(p.y - view.ty) / view.scale }
      },
      px: (pixels) => pixels / view.scale,
    }
  }, [view, svg, size])

  return (
    <div ref={containerRef} className={styles.viewport}>
      <svg
        ref={setSvg}
        className={styles.canvas}
        role="img"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {api && (
          <ViewportContext.Provider value={api}>
            <g className={styles.world} transform={`matrix(${api.transform.scale} 0 0 ${-api.transform.scale} ${api.transform.tx} ${api.transform.ty})`}>
              {children}
            </g>
          </ViewportContext.Provider>
        )}
      </svg>
      {overlay}
      <div className={styles.zoomControls}>
        <Button icon="fit" title="Fit to view" aria-label="Fit to view" onClick={fit} />
      </div>
    </div>
  )
}

interface WorldTextProps {
  at: Vec2
  children: ReactNode
  /** Screen-pixel offsets from the anchor */
  dx?: number
  dy?: number
  anchor?: 'start' | 'middle' | 'end'
  className?: string
}

/** Upright text at a world position, sized in screen pixels. */
export function WorldText({ at, children, dx = 0, dy = 0, anchor = 'start', className }: WorldTextProps) {
  const { transform } = useViewport()
  const k = 1 / transform.scale
  return (
    <text
      className={[styles.worldText, className].filter(Boolean).join(' ')}
      transform={`translate(${at.x} ${at.y}) scale(${k} ${-k})`}
      x={dx}
      y={dy}
      textAnchor={anchor}
    >
      {children}
    </text>
  )
}
