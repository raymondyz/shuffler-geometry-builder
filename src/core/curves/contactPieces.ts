import { TAU, angleInArc, wrapPi, wrapTau } from '../math/angle'
import { solveQuadratic } from '../math/roots'
import { add, angleOf, cross, dot, fromAngle, length, sub, type Vec2 } from '../math/vec2'
import { derivAt, deriv2At, endTangent, pointAt, startTangent, type ArcSegment, type CubicSegment, type Segment } from './segment'

/** Support-function data for one direction ψ: h = q·n(ψ), hd = h'(ψ) = q·n'(ψ), rho = radius of curvature at q. */
export interface SupportPoint {
  q: Vec2
  h: number
  hd: number
  rho: number
}

/**
 * A candidate for the support point of the outline. Curve pieces are convex (CCW-turning) runs of a
 * segment that own the outward-normal range [psiStart, psiStart + psiSpan]; outside that range their
 * evaluation clamps to the nearer endpoint. Point pieces (segment junctions) are valid for every ψ.
 */
export interface ContactPiece {
  kind: 'cubic' | 'arc' | 'point'
  segIndex: number
  psiStart: number
  psiSpan: number
  /** Parameter range on the source segment (curve pieces only). */
  t0: number
  t1: number
  inRange(psi: number): boolean
  support(psi: number): SupportPoint
  /** Segment parameter of the support point for an in-range ψ (curve pieces only). */
  paramAt(psi: number): number
}

const n = (psi: number): Vec2 => ({ x: Math.cos(psi), y: Math.sin(psi) })
const nPrime = (psi: number): Vec2 => ({ x: -Math.sin(psi), y: Math.cos(psi) })

function pointSupport(q: Vec2, psi: number): SupportPoint {
  return { q, h: dot(q, n(psi)), hd: dot(q, nPrime(psi)), rho: 0 }
}

/** Outward normal angle for a CCW outline, given the direction of travel. */
const normalAngle = (tangent: Vec2): number => wrapPi(angleOf(tangent) - Math.PI / 2)

function pointPiece(segIndex: number, q: Vec2): ContactPiece {
  return {
    kind: 'point',
    segIndex,
    psiStart: -Math.PI,
    psiSpan: TAU,
    t0: 0,
    t1: 0,
    inRange: () => true,
    support: (psi) => pointSupport(q, psi),
    paramAt: () => 0,
  }
}

function arcPiece(segIndex: number, arc: ArcSegment): ContactPiece {
  const psiStart = wrapPi(arc.startAngle)
  const psiSpan = arc.sweep
  const p0 = pointAt(arc, 0)
  const p1 = pointAt(arc, 1)
  const inRange = (psi: number) => angleInArc(psi, psiStart, psiSpan)
  return {
    kind: 'arc',
    segIndex,
    psiStart,
    psiSpan,
    t0: 0,
    t1: 1,
    inRange,
    support(psi) {
      if (!inRange(psi)) {
        const a = pointSupport(p0, psi)
        const b = pointSupport(p1, psi)
        return a.h >= b.h ? a : b
      }
      const dir = n(psi)
      return {
        q: add(arc.center, fromAngle(psi, arc.radius)),
        h: dot(arc.center, dir) + arc.radius,
        hd: dot(arc.center, nPrime(psi)),
        rho: arc.radius,
      }
    },
    paramAt: (psi) => wrapTau(psi - psiStart) / psiSpan,
  }
}

function cubicPiece(segIndex: number, seg: CubicSegment, t0: number, t1: number, tan0: Vec2, tan1: Vec2): ContactPiece {
  const psiStart = normalAngle(tan0)
  const psiSpan = wrapTau(normalAngle(tan1) - psiStart)
  const q0 = pointAt(seg, t0)
  const q1 = pointAt(seg, t1)
  // B'(t)/3 = A t² + B t + C
  const d0 = sub(seg.p1, seg.p0)
  const d1 = sub(seg.p2, seg.p1)
  const d2 = sub(seg.p3, seg.p2)
  const A = { x: d0.x - 2 * d1.x + d2.x, y: d0.y - 2 * d1.y + d2.y }
  const B = { x: 2 * (d1.x - d0.x), y: 2 * (d1.y - d0.y) }
  const C = d0
  const inRange = (psi: number) => angleInArc(psi, psiStart, psiSpan, 1e-12)
  const solveT = (psi: number): number | null => {
    const dir = n(psi)
    const roots = solveQuadratic(dot(A, dir), dot(B, dir), dot(C, dir))
    let best: number | null = null
    let bestScore = -Infinity
    const span = t1 - t0
    for (const r of roots) {
      if (r < t0 - 1e-9 * span || r > t1 + 1e-9 * span) continue
      const t = Math.min(t1, Math.max(t0, r))
      const d = derivAt(seg, t)
      // Outward normal of a CCW curve is the tangent rotated −90°: (dy, −dx)
      const score = d.y * dir.x - d.x * dir.y
      if (score > bestScore) {
        bestScore = score
        best = t
      }
    }
    return best !== null && bestScore > 0 ? best : null
  }
  const clamped = (psi: number): SupportPoint => {
    const a = pointSupport(q0, psi)
    const b = pointSupport(q1, psi)
    return a.h >= b.h ? a : b
  }
  return {
    kind: 'cubic',
    segIndex,
    psiStart,
    psiSpan,
    t0,
    t1,
    inRange,
    support(psi) {
      if (!inRange(psi)) return clamped(psi)
      const t = solveT(psi)
      if (t === null) return clamped(psi)
      const q = pointAt(seg, t)
      const d = derivAt(seg, t)
      const dd = deriv2At(seg, t)
      const k = cross(d, dd)
      const speed = length(d)
      return { q, h: dot(q, n(psi)), hd: dot(q, nPrime(psi)), rho: k > 0 ? (speed * speed * speed) / k : 0 }
    },
    paramAt(psi) {
      const t = solveT(psi)
      if (t !== null) return t
      return wrapTau(psi - psiStart) <= psiSpan / 2 ? t0 : t1
    },
  }
}

/** Parameters in (0, 1) where a cubic's curvature changes sign, i.e. roots of B'(t) × B''(t) (a quadratic). */
function cubicInflections(seg: CubicSegment): number[] {
  const d0 = sub(seg.p1, seg.p0)
  const d1 = sub(seg.p2, seg.p1)
  const d2 = sub(seg.p3, seg.p2)
  const a = { x: d0.x - 2 * d1.x + d2.x, y: d0.y - 2 * d1.y + d2.y }
  const b = { x: d1.x - d0.x, y: d1.y - d0.y }
  const c = d0
  // B'/3 = a t² + 2b t + c ; B''/6 = a t + b
  // (a t² + 2b t + c) × (a t + b) = −(a×b) t² + (c×a) t + c×b
  return solveQuadratic(-cross(a, b), cross(c, a), cross(c, b)).filter((t) => t > 1e-9 && t < 1 - 1e-9)
}

function cubicPieces(segIndex: number, seg: CubicSegment): ContactPiece[] {
  const splits = [0, ...cubicInflections(seg), 1]
  const pieces: ContactPiece[] = []
  for (let i = 0; i + 1 < splits.length; i++) {
    const t0 = splits[i]
    const t1 = splits[i + 1]
    const mid = (t0 + t1) / 2
    const turn = cross(derivAt(seg, mid), deriv2At(seg, mid))
    const scaleRef = length(derivAt(seg, mid)) ** 2
    if (!(turn > 1e-12 * scaleRef)) continue // concave or straight: never a support point
    const tan0 = t0 === 0 ? startTangent(seg) : derivAt(seg, t0)
    const tan1 = t1 === 1 ? endTangent(seg) : derivAt(seg, t1)
    pieces.push(cubicPiece(segIndex, seg, t0, t1, tan0, tan1))
  }
  return pieces
}

/**
 * Contact candidates for a CCW outline: convex curve runs plus every segment junction.
 * Concave runs and straight lines can never be the unique lowest point, so they are skipped;
 * the support function of the outline equals that of its convex hull.
 */
export function buildContactPieces(segments: Segment[]): ContactPiece[] {
  const pieces: ContactPiece[] = []
  segments.forEach((seg, i) => {
    pieces.push(pointPiece(i, pointAt(seg, 0)))
    if (seg.kind === 'arc' && seg.sweep > 0) pieces.push(arcPiece(i, seg))
    if (seg.kind === 'cubic') pieces.push(...cubicPieces(i, seg))
  })
  return pieces
}
