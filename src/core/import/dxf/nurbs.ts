import type { Segment } from '../../curves/segment'
import { add, cross, distance, dot, length, normalize, scale, sub, type Vec2 } from '../../math/vec2'
import { fitCurve2D, piece2DToBezier, type Sample2D } from '../../spline/curve'

// DXF SPLINE → outline segments (SPEC §14.3). Each knot span is one polynomial (or rational) piece;
// its Bézier control points come from blossoms, which works for clamped and unclamped knots alike.

export interface SplineData {
  degree: number
  knots: number[]
  points: Vec2[]
  /** One per control point; empty means all 1 */
  weights: number[]
  fitPoints: Vec2[]
  startTangent: Vec2 | null
  endTangent: Vec2 | null
}

export interface SplineSegments {
  segments: Segment[]
  /** True when some piece was fitted rather than converted exactly */
  approximated: boolean
}

/** Homogeneous point (w·x, w·y, w) */
interface HPoint {
  x: number
  y: number
  w: number
}

const lerpH = (a: HPoint, b: HPoint, t: number): HPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t })

const cart = (h: HPoint): Vec2 => ({ x: h.x / h.w, y: h.y / h.w })

/** Blossom of the piece on knot span i at the given arguments (de Boor with one argument per level). */
function blossom(P: HPoint[], U: number[], p: number, i: number, args: number[]): HPoint {
  const d = P.slice(i - p, i + 1)
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const k = i - p + j
      const den = U[k + p - r + 1] - U[k]
      d[j] = lerpH(d[j - 1], d[j], den === 0 ? 0 : (args[r - 1] - U[k]) / den)
    }
  }
  return d[p]
}

/** Bézier control points of knot span [U[i], U[i+1]]. */
function spanBezier(P: HPoint[], U: number[], p: number, i: number): HPoint[] {
  const a = U[i]
  const b = U[i + 1]
  return Array.from({ length: p + 1 }, (_, k) => blossom(P, U, p, i, [...Array<number>(p - k).fill(a), ...Array<number>(k).fill(b)]))
}

/** Point and derivative of a (rational) Bézier of any degree at t, by de Casteljau. */
function evalBezier(Q: HPoint[], t: number): Sample2D {
  const n = Q.length - 1
  let pts = Q
  let prev: HPoint[] = Q
  for (let r = 0; r < n; r++) {
    prev = pts
    pts = pts.slice(0, -1).map((q, j) => lerpH(q, pts[j + 1], t))
  }
  const h = pts[0]
  // The last two de Casteljau points give the homogeneous derivative
  const dh = n > 0 ? { x: n * (prev[1].x - prev[0].x), y: n * (prev[1].y - prev[0].y), w: n * (prev[1].w - prev[0].w) } : { x: 0, y: 0, w: 0 }
  const p = cart(h)
  return { p, d: { x: (dh.x - dh.w * p.x) / h.w, y: (dh.y - dh.w * p.y) / h.w } }
}

const cubic = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Segment => ({ kind: 'cubic', p0, p1, p2, p3 })

/** A rational quadratic piece that is exactly a circular arc (equal legs, middle weight cos(sweep/2)), or null. */
function rationalArc(Q: HPoint[]): Segment | null {
  const [q0, q1, q2] = Q.map(cart)
  const w = Q[1].w / Math.sqrt(Q[0].w * Q[2].w)
  const a = sub(q0, q1)
  const b = sub(q2, q1)
  const la = length(a)
  const lb = length(b)
  if (la < 1e-12 || lb < 1e-12 || Math.abs(la - lb) > 1e-9 * Math.max(la, lb)) return null
  const gamma = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb))))
  const turn = cross(sub(q1, q0), sub(q2, q1))
  if (Math.abs(turn) <= 1e-12 * la * lb) return w > 0 ? { kind: 'line', p0: q0, p1: q2 } : null
  if (Math.abs(w - Math.cos((Math.PI - gamma) / 2)) > 1e-9) return null
  const center = add(q1, scale(normalize(add(scale(a, 1 / la), scale(b, 1 / lb))), la / Math.cos(gamma / 2)))
  const start = sub(q0, center)
  return { kind: 'arc', center, radius: length(start), startAngle: Math.atan2(start.y, start.x), sweep: Math.sign(turn) * (Math.PI - gamma) }
}

function fitted(Q: HPoint[], tol: number): Segment[] {
  return fitCurve2D((t) => evalBezier(Q, t), 0, 1, tol).map(piece2DToBezier).map((z) => cubic(z.p0, z.p1, z.p2, z.p3))
}

/** Convert one Bézier piece: exact for degree ≤ 3 (and rational circles), fitted otherwise. */
function pieceSegments(Q: HPoint[], rational: boolean, tol: number): { segments: Segment[]; approximated: boolean } {
  const p = Q.length - 1
  const pts = Q.map(cart)
  if (pts.every((q) => distance(q, pts[0]) < 1e-12)) return { segments: [], approximated: false }
  if (!rational) {
    if (p === 1) return { segments: [{ kind: 'line', p0: pts[0], p1: pts[1] }], approximated: false }
    if (p === 2) {
      // Degree elevation: exact
      const [q0, q1, q2] = pts
      return { segments: [cubic(q0, add(q0, scale(sub(q1, q0), 2 / 3)), add(q2, scale(sub(q1, q2), 2 / 3)), q2)], approximated: false }
    }
    if (p === 3) return { segments: [cubic(pts[0], pts[1], pts[2], pts[3])], approximated: false }
  } else if (p === 2) {
    const arc = rationalArc(Q)
    if (arc) return { segments: [arc], approximated: false }
  }
  return { segments: fitted(Q, tol), approximated: true }
}

/** Cubic through fit points with chord-length spacing; CAD programs disagree on this curve, so it is an approximation. */
function interpolate(points: Vec2[], startTangent: Vec2 | null, endTangent: Vec2 | null): Segment[] {
  const pts = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 1e-12)
  if (pts.length < 2) return []
  const n = pts.length
  const tangent = (i: number): Vec2 => {
    if (i === 0) return normalize(startTangent && length(startTangent) > 0 ? startTangent : sub(pts[1], pts[0]))
    if (i === n - 1) return normalize(endTangent && length(endTangent) > 0 ? endTangent : sub(pts[n - 1], pts[n - 2]))
    return normalize(sub(pts[i + 1], pts[i - 1]))
  }
  const out: Segment[] = []
  for (let i = 0; i + 1 < n; i++) {
    const h = distance(pts[i], pts[i + 1]) / 3
    out.push(cubic(pts[i], add(pts[i], scale(tangent(i), h)), sub(pts[i + 1], scale(tangent(i + 1), h)), pts[i + 1]))
  }
  return out
}

/** Segments for a DXF spline, or null when its data is invalid. */
export function splineSegments(s: SplineData, tol: number): SplineSegments | null {
  if (s.points.length === 0) {
    if (s.fitPoints.length < 2) return null
    return { segments: interpolate(s.fitPoints, s.startTangent, s.endTangent), approximated: true }
  }
  const p = s.degree
  const n = s.points.length - 1
  const U = s.knots
  if (!Number.isInteger(p) || p < 1 || n < p || U.length !== n + p + 2) return null
  if (U.some((u, i) => !Number.isFinite(u) || (i > 0 && u < U[i - 1])) || !(U[n + 1] > U[p])) return null
  const weights = s.weights.length === s.points.length ? s.weights : s.points.map(() => 1)
  if (weights.some((w) => !(w > 0))) return null
  const wMax = weights.reduce((m, w) => Math.max(m, w), 0)
  const rational = weights.some((w) => Math.abs(w - wMax) > 1e-12 * wMax)
  const P: HPoint[] = s.points.map((q, i) => ({ x: q.x * weights[i], y: q.y * weights[i], w: weights[i] }))
  const segments: Segment[] = []
  let approximated = false
  for (let i = p; i <= n; i++) {
    if (!(U[i + 1] > U[i])) continue
    const piece = pieceSegments(spanBezier(P, U, p, i), rational, tol)
    segments.push(...piece.segments)
    approximated ||= piece.approximated
  }
  return { segments, approximated }
}
