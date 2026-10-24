import type { CubicSegment, Segment } from '../curves/segment'
import { add, cross, distance, dot, length, normalize, scale, sub, type Vec2 } from '../math/vec2'
import { boundsOf } from './segments'

// Curves exported as many short lines (SPEC §14.9). Every facet vertex would be a corner the foot rocks
// over, so runs of short, gently turning lines are refitted with cubic Béziers through their vertices.

/**
 * Detection: at least FACET_RUN consecutive lines, each turning less than FACET_TURN and shorter than
 * FACET_SIZE of the outline's size. Relative, because flat bottoms exported to a chord tolerance get long facets.
 */
const FACET_RUN = 8
const FACET_SIZE = 0.1
const FACET_TURN = (15 * Math.PI) / 180
/** Fitted curves pass within this of every facet vertex (which lie on the original curve), in mm */
export const SMOOTH_TOL = 0.02

export interface SmoothResult {
  segments: Segment[]
  runs: number
  lines: number
  curves: number
}

const turnAngle = (a: Vec2, b: Vec2) => Math.atan2(cross(a, b), dot(a, b))

interface Run {
  start: number
  count: number
  closed: boolean
}

/** Maximal runs of faceted lines in a closed chain (collinear lines already merged). */
function findRuns(segments: Segment[]): Run[] {
  const n = segments.length
  const b = boundsOf(segments)
  const maxLength = FACET_SIZE * Math.max(b.max.x - b.min.x, b.max.y - b.min.y)
  const facet = segments.map((s) => s.kind === 'line' && distance(s.p0, s.p1) < maxLength)
  const dirOf = (s: Segment) => (s.kind === 'line' ? sub(s.p1, s.p0) : { x: 0, y: 0 })
  // joint[i]: segments i and i + 1 continue one curve
  const joint = segments.map((s, i) => facet[i] && facet[(i + 1) % n] && Math.abs(turnAngle(dirOf(s), dirOf(segments[(i + 1) % n]))) < FACET_TURN)
  if (n >= FACET_RUN && joint.every(Boolean)) return [{ start: 0, count: n, closed: true }]
  const runs: Run[] = []
  // Start scanning just after a broken joint so no run is split by the wrap
  const first = joint.findIndex((j) => !j) + 1
  let i = 0
  while (i < n) {
    const k = (first + i) % n
    if (!facet[k]) {
      i++
      continue
    }
    let count = 1
    while (i + count < n && joint[(first + i + count - 1) % n]) count++
    if (count >= FACET_RUN) runs.push({ start: k, count, closed: false })
    i += count
  }
  return runs
}

const bez = (c: CubicSegment, t: number): Vec2 => {
  const u = 1 - t
  return add(add(scale(c.p0, u * u * u), scale(c.p1, 3 * u * u * t)), add(scale(c.p2, 3 * u * t * t), scale(c.p3, t * t * t)))
}
const bezD = (c: CubicSegment, t: number): Vec2 => {
  const u = 1 - t
  return add(add(scale(sub(c.p1, c.p0), 3 * u * u), scale(sub(c.p2, c.p1), 6 * u * t)), scale(sub(c.p3, c.p2), 3 * t * t))
}
const bezDD = (c: CubicSegment, t: number): Vec2 =>
  add(scale(add(sub(c.p2, scale(c.p1, 2)), c.p0), 6 * (1 - t)), scale(add(sub(c.p3, scale(c.p2, 2)), c.p1), 6 * t))

/** True if B′ × B″ keeps the sign `side` over [0, 1]: no inflection, turning the expected way. It is a quadratic in t. */
function turnsOneWay(c: CubicSegment, side: number): boolean {
  const q = (t: number) => cross(bezD(c, t), bezDD(c, t)) * side
  const q0 = q(0)
  const qh = q(0.5)
  const q1 = q(1)
  // q(t) = A t² + B t + C through the three samples
  const C = q0
  const A = 2 * (q1 - 2 * qh + q0)
  const B = q1 - q0 - A
  const scaleOf = Math.max(Math.abs(q0), Math.abs(qh), Math.abs(q1), 1e-30)
  let min = Math.min(q0, q1)
  if (A > 0) {
    const tv = -B / (2 * A)
    if (tv > 0 && tv < 1) min = Math.min(min, A * tv * tv + B * tv + C)
  }
  return min >= -1e-9 * scaleOf
}

function chordParams(pts: Vec2[]): number[] {
  const u = [0]
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + distance(pts[i], pts[i - 1]))
  const total = u[u.length - 1]
  return u.map((v) => v / total)
}

/** Least-squares handle lengths along fixed end tangents (Schneider's method). */
function fitWithTangents(pts: Vec2[], u: number[], t0: Vec2, t1: Vec2): CubicSegment {
  const p0 = pts[0]
  const p3 = pts[pts.length - 1]
  let c00 = 0
  let c01 = 0
  let c11 = 0
  let x0 = 0
  let x1 = 0
  for (let i = 0; i < pts.length; i++) {
    const t = u[i]
    const s = 1 - t
    const b0 = s * s * s
    const b1 = 3 * s * s * t
    const b2 = 3 * s * t * t
    const b3 = t * t * t
    const a1 = scale(t0, b1)
    const a2 = scale(t1, -b2)
    const base = add(scale(p0, b0 + b1), scale(p3, b2 + b3))
    const r = sub(pts[i], base)
    c00 += dot(a1, a1)
    c01 += dot(a1, a2)
    c11 += dot(a2, a2)
    x0 += dot(r, a1)
    x1 += dot(r, a2)
  }
  const det = c00 * c11 - c01 * c01
  const chord = distance(p0, p3)
  let alpha1 = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : NaN
  let alpha2 = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : NaN
  if (!(alpha1 > chord * 1e-6) || !(alpha2 > chord * 1e-6) || alpha1 > chord || alpha2 > chord) alpha1 = alpha2 = chord / 3
  return { kind: 'cubic', p0, p1: add(p0, scale(t0, alpha1)), p2: sub(p3, scale(t1, alpha2)), p3 }
}

function maxError(c: CubicSegment, pts: Vec2[], u: number[]): { error: number; index: number } {
  let error = 0
  let index = Math.floor(pts.length / 2)
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distance(bez(c, u[i]), pts[i])
    if (d > error) {
      error = d
      index = i
    }
  }
  return { error, index }
}

/** Newton step on each parameter towards the nearest point of the curve. */
function reparametrize(c: CubicSegment, pts: Vec2[], u: number[]): number[] {
  return u.map((t, i) => {
    if (i === 0 || i === u.length - 1) return t
    const d = sub(bez(c, t), pts[i])
    const d1 = bezD(c, t)
    const den = dot(d1, d1) + dot(d, bezDD(c, t))
    return den > 0 ? Math.max(0, Math.min(1, t - dot(d, d1) / den)) : t
  })
}

function fitRange(pts: Vec2[], t0: Vec2, t1: Vec2, side: number, out: CubicSegment[], depth = 0) {
  const chord = distance(pts[0], pts[pts.length - 1])
  if (pts.length <= 2 || depth > 24) {
    out.push({ kind: 'cubic', p0: pts[0], p1: add(pts[0], scale(t0, chord / 3)), p2: sub(pts[pts.length - 1], scale(t1, chord / 3)), p3: pts[pts.length - 1] })
    return
  }
  let u = chordParams(pts)
  let c = fitWithTangents(pts, u, t0, t1)
  let fit = maxError(c, pts, u)
  for (let iter = 0; iter < 6 && fit.error > SMOOTH_TOL && fit.error < 8 * SMOOTH_TOL; iter++) {
    u = reparametrize(c, pts, u)
    c = fitWithTangents(pts, u, t0, t1)
    fit = maxError(c, pts, u)
  }
  if (fit.error <= SMOOTH_TOL && (side === 0 || turnsOneWay(c, side))) {
    out.push(c)
    return
  }
  // Split where the fit is worst (or in the middle if only convexity failed), sharing the tangent there
  const k = fit.error > SMOOTH_TOL ? Math.max(1, Math.min(pts.length - 2, fit.index)) : Math.floor((pts.length - 1) / 2)
  const tk = normalize(sub(pts[k + 1], pts[k - 1]))
  fitRange(pts.slice(0, k + 1), t0, tk, side, out, depth + 1)
  fitRange(pts.slice(k), tk, t1, side, out, depth + 1)
}

/** Refit a run of facet vertices; `side` is the sign of every turn if they all agree, else 0. */
function fitRun(pts: Vec2[], closed: boolean): CubicSegment[] {
  const n = pts.length
  const turns = pts.slice(1, -1).map((p, i) => cross(normalize(sub(p, pts[i])), normalize(sub(pts[i + 2], p))))
  // Straight stretches inside a convex run don't count against it
  const side = turns.every((t) => t >= -1e-9) && turns.some((t) => t > 1e-9) ? 1 : turns.every((t) => t <= 1e-9) && turns.some((t) => t < -1e-9) ? -1 : 0
  let t0: Vec2
  let t1: Vec2
  if (closed) {
    // pts[0] === pts[n − 1]: the same tangent on both sides keeps the closed curve smooth
    t0 = t1 = normalize(sub(pts[1], pts[n - 2]))
  } else {
    // Second-order one-sided differences estimate the end tangents better than the end chords
    t0 = normalize(add(scale(sub(pts[1], pts[0]), 2), scale(sub(pts[2], pts[0]), -0.5)))
    t1 = normalize(add(scale(sub(pts[n - 1], pts[n - 2]), 2), scale(sub(pts[n - 1], pts[n - 3]), -0.5)))
  }
  if (!(length(t0) > 0)) t0 = normalize(sub(pts[1], pts[0]))
  if (!(length(t1) > 0)) t1 = normalize(sub(pts[n - 1], pts[n - 2]))
  const out: CubicSegment[] = []
  fitRange(pts, t0, t1, side, out)
  return out
}

export function countFacetedRuns(segments: Segment[]): { runs: number; lines: number } {
  const runs = findRuns(segments)
  return { runs: runs.length, lines: runs.reduce((t, r) => t + r.count, 0) }
}

/** Replace every faceted run of a closed chain with smooth cubics. */
export function smoothFaceted(segments: Segment[]): SmoothResult {
  const runs = findRuns(segments)
  if (runs.length === 0) return { segments, runs: 0, lines: 0, curves: 0 }
  const n = segments.length
  const replaced = new Map<number, CubicSegment[]>()
  const skip = new Set<number>()
  let curves = 0
  for (const run of runs) {
    const idx = Array.from({ length: run.count }, (_, j) => (run.start + j) % n)
    const pts = [...idx.map((k) => (segments[k] as { p0: Vec2 }).p0), (segments[idx[idx.length - 1]] as { p1: Vec2 }).p1]
    const fit = fitRun(pts, run.closed)
    curves += fit.length
    replaced.set(idx[0], fit)
    for (const k of idx.slice(1)) skip.add(k)
  }
  const out: Segment[] = []
  for (let k = 0; k < n; k++) {
    if (skip.has(k)) continue
    out.push(...(replaced.get(k) ?? [segments[k]]))
  }
  return { segments: out, runs: runs.length, lines: runs.reduce((t, r) => t + r.count, 0), curves }
}
