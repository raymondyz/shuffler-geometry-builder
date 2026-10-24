import { arcFromBulge, flatten } from '../curves/outline'
import { endPoint, startPoint, type CubicSegment, type Segment } from '../curves/segment'
import { TAU } from '../math/angle'
import { add, angleOf, cross, distance, dot, equals, fromAngle, length, sub, type Vec2 } from '../math/vec2'

/** 2D affine map p ↦ (a·x + b·y + tx, c·x + d·y + ty). */
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  tx: number
  ty: number
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

export const applyAffine = (m: Affine, p: Vec2): Vec2 => ({ x: m.a * p.x + m.b * p.y + m.tx, y: m.c * p.x + m.d * p.y + m.ty })

const linear = (m: Affine, v: Vec2): Vec2 => ({ x: m.a * v.x + m.b * v.y, y: m.c * v.x + m.d * v.y })

/** m ∘ n: apply n first, then m. */
export function compose(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.b * n.c,
    b: m.a * n.b + m.b * n.d,
    c: m.c * n.a + m.d * n.c,
    d: m.c * n.b + m.d * n.d,
    tx: m.a * n.tx + m.b * n.ty + m.tx,
    ty: m.c * n.tx + m.d * n.ty + m.ty,
  }
}

export const translation = (t: Vec2): Affine => ({ ...IDENTITY, tx: t.x, ty: t.y })

export function rotation(angle: number): Affine {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { a: c, b: -s, c: s, d: c, tx: 0, ty: 0 }
}

export const scaling = (sx: number, sy = sx): Affine => ({ a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 })

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c
  const a = m.d / det
  const b = -m.b / det
  const c = -m.c / det
  const d = m.a / det
  return { a, b, c, d, tx: -(a * m.tx + b * m.ty), ty: -(c * m.tx + d * m.ty) }
}

const determinant = (m: Affine): number => m.a * m.d - m.b * m.c

/** Largest stretch of the linear part (its largest singular value). */
function maxStretch(m: Affine): number {
  const p = m.a * m.a + m.c * m.c
  const q = m.a * m.b + m.c * m.d
  const r = m.b * m.b + m.d * m.d
  return Math.sqrt((p + r) / 2 + Math.sqrt(((p - r) / 2) ** 2 + q * q))
}

/** Rotation and uniform scale, possibly mirrored: maps circles to circles. */
function isSimilarity(m: Affine): boolean {
  const s = Math.max(Math.abs(m.a), Math.abs(m.b), Math.abs(m.c), Math.abs(m.d)) * 1e-9
  return (Math.abs(m.a - m.d) <= s && Math.abs(m.b + m.c) <= s) || (Math.abs(m.a + m.d) <= s && Math.abs(m.b - m.c) <= s)
}

/**
 * Pieces needed for the cubic approximation of a circular arc to stay within `tol`. The standard
 * 4/3·tan(θ/4) handles are off by at most 2.7e-4·r over 90°, and the error grows as θ⁶.
 */
export function arcPieceCount(sweep: number, radius: number, tol: number): number {
  const maxAngle = Math.min(Math.PI / 2, (Math.PI / 2) * Math.pow(tol / (2.7e-4 * Math.max(radius, 1e-12)), 1 / 6))
  return Math.max(1, Math.ceil(Math.abs(sweep) / maxAngle - 1e-9))
}

/**
 * Cubic Béziers for the unit-circle arc t0 → t0 + sweep, mapped through m. Béziers are
 * affine-invariant, so this covers circles under any map and ellipses (SPEC §14.3).
 */
export function unitArcCubics(t0: number, sweep: number, pieces: number, m: Affine): CubicSegment[] {
  const step = sweep / pieces
  const k = (4 / 3) * Math.tan(step / 4)
  const out: CubicSegment[] = []
  for (let i = 0; i < pieces; i++) {
    const a0 = t0 + step * i
    const a1 = a0 + step
    const p0 = fromAngle(a0)
    const p3 = fromAngle(a1)
    const p1 = { x: p0.x - k * Math.sin(a0), y: p0.y + k * Math.cos(a0) }
    const p2 = { x: p3.x + k * Math.sin(a1), y: p3.y - k * Math.cos(a1) }
    out.push({ kind: 'cubic', p0: applyAffine(m, p0), p1: applyAffine(m, p1), p2: applyAffine(m, p2), p3: applyAffine(m, p3) })
  }
  return out
}

/** Image of a segment under an affine map: exact, except arcs under a non-uniform scale, which become cubics within `tol`. */
export function transformSegment(seg: Segment, m: Affine, tol: number): Segment[] {
  switch (seg.kind) {
    case 'line':
      return [{ kind: 'line', p0: applyAffine(m, seg.p0), p1: applyAffine(m, seg.p1) }]
    case 'cubic':
      return [{ kind: 'cubic', p0: applyAffine(m, seg.p0), p1: applyAffine(m, seg.p1), p2: applyAffine(m, seg.p2), p3: applyAffine(m, seg.p3) }]
    case 'arc': {
      const det = determinant(m)
      if (isSimilarity(m)) {
        return [{
          kind: 'arc',
          center: applyAffine(m, seg.center),
          radius: seg.radius * Math.sqrt(Math.abs(det)),
          startAngle: angleOf(linear(m, fromAngle(seg.startAngle))),
          sweep: det < 0 ? -seg.sweep : seg.sweep,
        }]
      }
      const local = compose(m, compose(translation(seg.center), scaling(seg.radius)))
      return unitArcCubics(seg.startAngle, seg.sweep, arcPieceCount(seg.sweep, seg.radius * maxStretch(m), tol), local)
    }
  }
}

/** Arc length for lines and arcs; the control polygon (an upper bound) for cubics. */
export function segmentLength(seg: Segment): number {
  switch (seg.kind) {
    case 'line':
      return distance(seg.p0, seg.p1)
    case 'arc':
      return seg.radius * Math.abs(seg.sweep)
    case 'cubic':
      return distance(seg.p0, seg.p1) + distance(seg.p1, seg.p2) + distance(seg.p2, seg.p3)
  }
}

/** The segment with its ends moved to a and b: lines exactly, cubics carry their handles along, arcs keep their sweep. */
export function withEnds(seg: Segment, a: Vec2, b: Vec2): Segment {
  if (equals(a, startPoint(seg), 0) && equals(b, endPoint(seg), 0)) return seg
  switch (seg.kind) {
    case 'line':
      return { kind: 'line', p0: a, p1: b }
    case 'cubic':
      return { kind: 'cubic', p0: a, p1: add(seg.p1, sub(a, seg.p0)), p2: add(seg.p2, sub(b, seg.p3)), p3: b }
    case 'arc':
      return distance(a, b) > 0 ? arcFromBulge(a, b, Math.tan(seg.sweep / 4)) : seg
  }
}

const MERGE_TOL = 1e-6

/** One segment for two consecutive collinear lines or co-circular arcs, or null. Exact (within 1e-6 mm). */
function joined(a: Segment, b: Segment): Segment | null {
  if (a.kind === 'line' && b.kind === 'line') {
    const chord = sub(b.p1, a.p0)
    const c = length(chord)
    if (c === 0 || dot(sub(a.p1, a.p0), sub(b.p1, b.p0)) <= 0) return null
    return Math.abs(cross(chord, sub(a.p1, a.p0))) / c <= MERGE_TOL ? { kind: 'line', p0: a.p0, p1: b.p1 } : null
  }
  if (a.kind === 'arc' && b.kind === 'arc') {
    if (Math.sign(a.sweep) !== Math.sign(b.sweep)) return null
    if (distance(a.center, b.center) > MERGE_TOL || Math.abs(a.radius - b.radius) > MERGE_TOL) return null
    const sweep = a.sweep + b.sweep
    // Full circles stay in two pieces: an outline edge can't start and end at the same node
    return Math.abs(sweep) < TAU * 0.75 ? { ...a, sweep } : null
  }
  return null
}

/** Merge consecutive collinear lines and co-circular arcs of a closed chain (CAD often splits circles into quadrants). */
export function mergeLoop(segments: Segment[]): Segment[] {
  const out: Segment[] = []
  for (const seg of segments) {
    const m = out.length > 0 ? joined(out[out.length - 1], seg) : null
    if (m) out[out.length - 1] = m
    else out.push(seg)
  }
  while (out.length > 2) {
    const m = joined(out[out.length - 1], out[0])
    if (!m) break
    out[0] = m
    out.pop()
  }
  return out
}

export interface Bounds {
  min: Vec2
  max: Vec2
}

export function boundsOf(segments: Segment[]): Bounds {
  const min = { x: Infinity, y: Infinity }
  const max = { x: -Infinity, y: -Infinity }
  for (const p of flatten(segments, 16)) {
    min.x = Math.min(min.x, p.x)
    min.y = Math.min(min.y, p.y)
    max.x = Math.max(max.x, p.x)
    max.y = Math.max(max.y, p.y)
  }
  return min.x <= max.x ? { min, max } : { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }
}

export const isFinitePoint = (p: Vec2): boolean => Number.isFinite(p.x) && Number.isFinite(p.y)

export function isFiniteSegment(seg: Segment): boolean {
  switch (seg.kind) {
    case 'line':
      return isFinitePoint(seg.p0) && isFinitePoint(seg.p1)
    case 'arc':
      return isFinitePoint(seg.center) && Number.isFinite(seg.radius) && seg.radius > 0 && Number.isFinite(seg.startAngle) && Number.isFinite(seg.sweep)
    case 'cubic':
      return [seg.p0, seg.p1, seg.p2, seg.p3].every(isFinitePoint)
  }
}
