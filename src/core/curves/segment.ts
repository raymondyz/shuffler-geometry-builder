import { add, fromAngle, lerp, scale, sub, length, type Vec2 } from '../math/vec2'

export interface LineSegment {
  kind: 'line'
  p0: Vec2
  p1: Vec2
}

/** Circular arc: centre, radius, start angle and signed sweep (CCW positive), all in radians. */
export interface ArcSegment {
  kind: 'arc'
  center: Vec2
  radius: number
  startAngle: number
  sweep: number
}

export interface CubicSegment {
  kind: 'cubic'
  p0: Vec2
  p1: Vec2
  p2: Vec2
  p3: Vec2
}

export type Segment = LineSegment | ArcSegment | CubicSegment

export function pointAt(seg: Segment, t: number): Vec2 {
  switch (seg.kind) {
    case 'line':
      return lerp(seg.p0, seg.p1, t)
    case 'arc':
      return add(seg.center, fromAngle(seg.startAngle + seg.sweep * t, seg.radius))
    case 'cubic': {
      const u = 1 - t
      const a = u * u * u
      const b = 3 * u * u * t
      const c = 3 * u * t * t
      const d = t * t * t
      return {
        x: a * seg.p0.x + b * seg.p1.x + c * seg.p2.x + d * seg.p3.x,
        y: a * seg.p0.y + b * seg.p1.y + c * seg.p2.y + d * seg.p3.y,
      }
    }
  }
}

export function derivAt(seg: Segment, t: number): Vec2 {
  switch (seg.kind) {
    case 'line':
      return sub(seg.p1, seg.p0)
    case 'arc': {
      const a = seg.startAngle + seg.sweep * t
      const k = seg.radius * seg.sweep
      return { x: -k * Math.sin(a), y: k * Math.cos(a) }
    }
    case 'cubic': {
      const u = 1 - t
      const a = 3 * u * u
      const b = 6 * u * t
      const c = 3 * t * t
      return {
        x: a * (seg.p1.x - seg.p0.x) + b * (seg.p2.x - seg.p1.x) + c * (seg.p3.x - seg.p2.x),
        y: a * (seg.p1.y - seg.p0.y) + b * (seg.p2.y - seg.p1.y) + c * (seg.p3.y - seg.p2.y),
      }
    }
  }
}

export function deriv2At(seg: Segment, t: number): Vec2 {
  switch (seg.kind) {
    case 'line':
      return { x: 0, y: 0 }
    case 'arc': {
      const a = seg.startAngle + seg.sweep * t
      const k = -seg.radius * seg.sweep * seg.sweep
      return { x: k * Math.cos(a), y: k * Math.sin(a) }
    }
    case 'cubic': {
      const u = 1 - t
      return {
        x: 6 * u * (seg.p2.x - 2 * seg.p1.x + seg.p0.x) + 6 * t * (seg.p3.x - 2 * seg.p2.x + seg.p1.x),
        y: 6 * u * (seg.p2.y - 2 * seg.p1.y + seg.p0.y) + 6 * t * (seg.p3.y - 2 * seg.p2.y + seg.p1.y),
      }
    }
  }
}

export const startPoint = (seg: Segment): Vec2 => pointAt(seg, 0)

export const endPoint = (seg: Segment): Vec2 => pointAt(seg, 1)

const TANGENT_EPS = 1e-9

/** Direction of travel at the start, robust to zero-length cubic handles. */
export function startTangent(seg: Segment): Vec2 {
  if (seg.kind !== 'cubic') return derivAt(seg, 0)
  for (const p of [seg.p1, seg.p2, seg.p3]) {
    const d = sub(p, seg.p0)
    if (length(d) > TANGENT_EPS) return d
  }
  return { x: 0, y: 0 }
}

/** Direction of travel at the end, robust to zero-length cubic handles. */
export function endTangent(seg: Segment): Vec2 {
  if (seg.kind !== 'cubic') return derivAt(seg, 1)
  for (const p of [seg.p2, seg.p1, seg.p0]) {
    const d = sub(seg.p3, p)
    if (length(d) > TANGENT_EPS) return d
  }
  return { x: 0, y: 0 }
}

export function reverseSegment(seg: Segment): Segment {
  switch (seg.kind) {
    case 'line':
      return { kind: 'line', p0: seg.p1, p1: seg.p0 }
    case 'arc':
      return { ...seg, startAngle: seg.startAngle + seg.sweep, sweep: -seg.sweep }
    case 'cubic':
      return { kind: 'cubic', p0: seg.p3, p1: seg.p2, p2: seg.p1, p3: seg.p0 }
  }
}

/** de Casteljau split of a cubic at t. */
export function splitCubic(c: CubicSegment, t: number): [CubicSegment, CubicSegment] {
  const a = lerp(c.p0, c.p1, t)
  const b = lerp(c.p1, c.p2, t)
  const d = lerp(c.p2, c.p3, t)
  const ab = lerp(a, b, t)
  const bd = lerp(b, d, t)
  const m = lerp(ab, bd, t)
  return [
    { kind: 'cubic', p0: c.p0, p1: a, p2: ab, p3: m },
    { kind: 'cubic', p0: m, p1: bd, p2: d, p3: c.p3 },
  ]
}

/** The part of a segment between parameters t0 < t1. */
export function subSegment(seg: Segment, t0: number, t1: number): Segment {
  switch (seg.kind) {
    case 'line':
      return { kind: 'line', p0: pointAt(seg, t0), p1: pointAt(seg, t1) }
    case 'arc':
      return { ...seg, startAngle: seg.startAngle + seg.sweep * t0, sweep: seg.sweep * (t1 - t0) }
    case 'cubic': {
      if (t0 <= 0 && t1 >= 1) return seg
      const right = t0 > 0 ? splitCubic(seg, t0)[1] : seg
      if (t1 >= 1) return right
      const local = (t1 - t0) / (1 - t0)
      return splitCubic(right, local)[0]
    }
  }
}

/** Cubic Bézier that matches a circular arc (standard 4/3·tan(θ/4) handles), split into ≤ 90° pieces. */
export function arcToCubics(arc: ArcSegment): CubicSegment[] {
  const pieces = Math.max(1, Math.ceil(Math.abs(arc.sweep) / (Math.PI / 2) - 1e-9))
  const step = arc.sweep / pieces
  const k = (4 / 3) * Math.tan(step / 4) * arc.radius
  const out: CubicSegment[] = []
  for (let i = 0; i < pieces; i++) {
    const a0 = arc.startAngle + step * i
    const a1 = a0 + step
    const p0 = add(arc.center, fromAngle(a0, arc.radius))
    const p3 = add(arc.center, fromAngle(a1, arc.radius))
    const t0 = { x: -Math.sin(a0), y: Math.cos(a0) }
    const t1 = { x: -Math.sin(a1), y: Math.cos(a1) }
    out.push({ kind: 'cubic', p0, p1: add(p0, scale(t0, k)), p2: sub(p3, scale(t1, k)), p3 })
  }
  return out
}
