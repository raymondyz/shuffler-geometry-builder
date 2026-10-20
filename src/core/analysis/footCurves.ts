import { TAU } from '../math/angle'
import { fitCurve1D, fitCurve2D, type Curve1D, type Curve2D } from '../spline/curve'
import type { FootEvent } from './events'
import type { FootModel } from './foot'

/** Default spline tolerance: far below anything visible or machinable (mm). */
export const CURVE_TOL = 1e-4

export interface Interval {
  a: number
  b: number
}

/** Event-free intervals covering [start, end], split at every event that falls strictly inside. */
export function smoothIntervals(events: FootEvent[], start: number, end: number, shift = 0): Interval[] {
  const cuts = events
    .map((e) => start + ((((e.phi - shift - start) % TAU) + TAU) % TAU))
    .filter((p) => p > start + 1e-12 && p < end - 1e-12)
    .sort((a, b) => a - b)
  const bounds = [start, ...cuts, end]
  const out: Interval[] = []
  for (let i = 0; i + 1 < bounds.length; i++) out.push({ a: bounds[i], b: bounds[i + 1] })
  return out
}

export interface FootCurves {
  /** y₀(φ): height of foot 0's lowest point */
  height: Curve1D
  /** C₀(φ): body-frame path of foot 0's lowest point */
  trace: Curve2D
  /** v₀(φ): no-slip travel per radian if foot 0 were the stance foot */
  speed: Curve1D
}

export function fitFootCurves(model: FootModel, events: FootEvent[], tol = CURVE_TOL): FootCurves {
  const height: Curve1D = { pieces: [] }
  const trace: Curve2D = { pieces: [] }
  const speed: Curve1D = { pieces: [] }
  for (const { a, b } of smoothIntervals(events, 0, TAU)) {
    const owner = model.pieceAt((a + b) / 2)
    const s = (phi: number) => model.sample(phi, owner)
    height.pieces.push(...fitCurve1D((phi) => { const x = s(phi); return { v: x.y, d: x.yD } }, a, b, tol))
    trace.pieces.push(...fitCurve2D((phi) => { const x = s(phi); return { p: x.contact, d: x.contactD } }, a, b, tol))
    speed.pieces.push(...fitCurve1D((phi) => { const x = s(phi); return { v: x.v, d: x.vD } }, a, b, tol))
  }
  return { height, trace, speed }
}

/** Contact path of foot 0 restricted to [a, b] (may extend past 2π; the model is periodic). */
export function fitTraceRange(model: FootModel, events: FootEvent[], a: number, b: number, tol = CURVE_TOL): Curve2D {
  const trace: Curve2D = { pieces: [] }
  for (const iv of smoothIntervals(events, a, b)) {
    const owner = model.pieceAt((iv.a + iv.b) / 2)
    trace.pieces.push(...fitCurve2D((phi) => { const x = model.sample(phi, owner); return { p: x.contact, d: x.contactD } }, iv.a, iv.b, tol))
  }
  return trace
}
