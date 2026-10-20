import type { Vec2 } from '../math/vec2'

/** Cubic Hermite piece of a scalar function on [t0, t1] from end values and end derivatives. */
export interface HermitePiece {
  t0: number
  t1: number
  v0: number
  v1: number
  d0: number
  d1: number
}

/** Cubic Hermite piece of a planar parametric curve. */
export interface HermitePiece2D {
  t0: number
  t1: number
  p0: Vec2
  p1: Vec2
  d0: Vec2
  d1: Vec2
}

/** Piecewise-cubic scalar function. Pieces are contiguous in t; values may jump between pieces at events. */
export interface Curve1D {
  pieces: HermitePiece[]
}

export interface Curve2D {
  pieces: HermitePiece2D[]
}

export interface CubicBezier {
  p0: Vec2
  p1: Vec2
  p2: Vec2
  p3: Vec2
}

function hermiteBasis(s: number) {
  const s2 = s * s
  const s3 = s2 * s
  return { h00: 2 * s3 - 3 * s2 + 1, h10: s3 - 2 * s2 + s, h01: -2 * s3 + 3 * s2, h11: s3 - s2 }
}

export function evalPiece(p: HermitePiece, t: number): number {
  const h = p.t1 - p.t0
  const { h00, h10, h01, h11 } = hermiteBasis((t - p.t0) / h)
  return h00 * p.v0 + h10 * h * p.d0 + h01 * p.v1 + h11 * h * p.d1
}

export function evalPiece2D(p: HermitePiece2D, t: number): Vec2 {
  const h = p.t1 - p.t0
  const { h00, h10, h01, h11 } = hermiteBasis((t - p.t0) / h)
  return {
    x: h00 * p.p0.x + h10 * h * p.d0.x + h01 * p.p1.x + h11 * h * p.d1.x,
    y: h00 * p.p0.y + h10 * h * p.d0.y + h01 * p.p1.y + h11 * h * p.d1.y,
  }
}

function findPiece<P extends { t0: number; t1: number }>(pieces: P[], t: number): P {
  let lo = 0
  let hi = pieces.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (pieces[mid].t0 <= t) lo = mid
    else hi = mid - 1
  }
  return pieces[lo]
}

export const evalCurve1D = (c: Curve1D, t: number): number => evalPiece(findPiece(c.pieces, t), t)

export const evalCurve2D = (c: Curve2D, t: number): Vec2 => evalPiece2D(findPiece(c.pieces, t), t)

export interface Sample1D {
  v: number
  d: number
}

export interface Sample2D {
  p: Vec2
  d: Vec2
}

const MAX_DEPTH = 14
const CHECKS = [0.25, 0.5, 0.75]

/**
 * Adaptive cubic Hermite fit of a smooth function on [a, b] using exact values and derivatives.
 * Splits at the midpoint until the fit is within `tol` at the quarter points (error is O(h⁴)).
 */
export function fitCurve1D(f: (t: number) => Sample1D, a: number, b: number, tol: number): HermitePiece[] {
  const out: HermitePiece[] = []
  const fit = (t0: number, s0: Sample1D, t1: number, s1: Sample1D, depth: number) => {
    const piece = { t0, t1, v0: s0.v, v1: s1.v, d0: s0.d, d1: s1.d }
    let worst = 0
    let mid: Sample1D | null = null
    for (const c of CHECKS) {
      const t = t0 + (t1 - t0) * c
      const s = f(t)
      if (c === 0.5) mid = s
      worst = Math.max(worst, Math.abs(s.v - evalPiece(piece, t)))
    }
    if (worst <= tol || depth >= MAX_DEPTH || !mid) {
      out.push(piece)
      return
    }
    const tm = (t0 + t1) / 2
    fit(t0, s0, tm, mid, depth + 1)
    fit(tm, mid, t1, s1, depth + 1)
  }
  fit(a, f(a), b, f(b), 0)
  return out
}

/** Planar version of fitCurve1D; the error is measured as Euclidean distance. */
export function fitCurve2D(f: (t: number) => Sample2D, a: number, b: number, tol: number): HermitePiece2D[] {
  const out: HermitePiece2D[] = []
  const fit = (t0: number, s0: Sample2D, t1: number, s1: Sample2D, depth: number) => {
    const piece = { t0, t1, p0: s0.p, p1: s1.p, d0: s0.d, d1: s1.d }
    let worst = 0
    let mid: Sample2D | null = null
    for (const c of CHECKS) {
      const t = t0 + (t1 - t0) * c
      const s = f(t)
      if (c === 0.5) mid = s
      const e = evalPiece2D(piece, t)
      worst = Math.max(worst, Math.hypot(s.p.x - e.x, s.p.y - e.y))
    }
    if (worst <= tol || depth >= MAX_DEPTH || !mid) {
      out.push(piece)
      return
    }
    const tm = (t0 + t1) / 2
    fit(t0, s0, tm, mid, depth + 1)
    fit(tm, mid, t1, s1, depth + 1)
  }
  fit(a, f(a), b, f(b), 0)
  return out
}

/** Exact Bézier form of a scalar Hermite piece drawn as the graph (t, v(t)). */
export function pieceToBezier(p: HermitePiece): CubicBezier {
  const h = p.t1 - p.t0
  return {
    p0: { x: p.t0, y: p.v0 },
    p1: { x: p.t0 + h / 3, y: p.v0 + (h * p.d0) / 3 },
    p2: { x: p.t1 - h / 3, y: p.v1 - (h * p.d1) / 3 },
    p3: { x: p.t1, y: p.v1 },
  }
}

/** Exact Bézier form of a planar Hermite piece. */
export function piece2DToBezier(p: HermitePiece2D): CubicBezier {
  const h = p.t1 - p.t0
  return {
    p0: p.p0,
    p1: { x: p.p0.x + (h * p.d0.x) / 3, y: p.p0.y + (h * p.d0.y) / 3 },
    p2: { x: p.p1.x - (h * p.d1.x) / 3, y: p.p1.y - (h * p.d1.y) / 3 },
    p3: p.p1,
  }
}

export const shiftCurve1D = (c: Curve1D, dt: number): Curve1D => ({
  pieces: c.pieces.map((p) => ({ ...p, t0: p.t0 + dt, t1: p.t1 + dt })),
})
