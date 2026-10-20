import { createContext, useContext } from 'react'
import type { Vec2 } from '../../core/math/vec2'

export interface Bounds {
  min: Vec2
  max: Vec2
}

/** World (mm, y up) → screen (px, y down): sx = x·scale + tx, sy = −y·scale + ty */
export interface ViewTransform {
  scale: number
  tx: number
  ty: number
}

export interface ViewportApi {
  transform: ViewTransform
  /** World rectangle currently on screen */
  visible: Bounds
  /** World coordinates of a pointer event's client position */
  toWorld(clientX: number, clientY: number): Vec2
  /** World length of a screen distance in px (for markers that keep a constant on-screen size) */
  px(pixels: number): number
}

export const ViewportContext = createContext<ViewportApi | null>(null)

/** Access the enclosing <Viewport>'s transform and coordinate helpers. */
export function useViewport(): ViewportApi {
  const api = useContext(ViewportContext)
  if (!api) throw new Error('useViewport must be used inside <Viewport>')
  return api
}
