import { integrate } from '../math/quadrature'
import { add, angleOf, cross, distance, dot, length, midpoint, perp, scale, sub, type Vec2 } from '../math/vec2'
import { derivAt, pointAt, reverseSegment, type ArcSegment, type Segment } from './segment'

export type NodeMode = 'corner' | 'smooth' | 'symmetric'

export type EdgeKind = 'cubic' | 'line' | 'arc'

/** An anchor of the editable outline. Handles are offsets relative to the anchor. */
export interface OutlineNode {
  id: string
  p: Vec2
  hIn: Vec2
  hOut: Vec2
  mode: NodeMode
}

/** Edge i joins node i to node (i + 1) % n. `bulge` = tan(sweep / 4) is only used by arcs. */
export interface OutlineEdge {
  kind: EdgeKind
  bulge: number
}

/** Closed outline in the foot frame (P1 at the origin, foot at neutral tilt). */
export interface Outline {
  nodes: OutlineNode[]
  edges: OutlineEdge[]
}

const MIN_BULGE = 1e-9

/** Arc through p0 → p1 with DXF-style bulge (positive = CCW). */
export function arcFromBulge(p0: Vec2, p1: Vec2, bulge: number): ArcSegment {
  const chord = sub(p1, p0)
  const c = length(chord)
  const dir = scale(chord, 1 / c)
  const offset = (c * (1 - bulge * bulge)) / (4 * bulge)
  const center = add(midpoint(p0, p1), scale(perp(dir), offset))
  const radius = (c * (1 + bulge * bulge)) / (4 * Math.abs(bulge))
  return { kind: 'arc', center, radius, startAngle: angleOf(sub(p0, center)), sweep: 4 * Math.atan(bulge) }
}

/** Point at the middle of the arc defined by p0 → p1 and bulge. */
export function bulgeMidpoint(p0: Vec2, p1: Vec2, bulge: number): Vec2 {
  const chord = sub(p1, p0)
  return add(midpoint(p0, p1), scale(perp(chord), -bulge / 2))
}

/** Inverse of bulgeMidpoint: the bulge whose arc midpoint is closest to `m`. */
export function bulgeFromMidpoint(p0: Vec2, p1: Vec2, m: Vec2): number {
  const chord = sub(p1, p0)
  const c2 = dot(chord, chord)
  if (c2 === 0) return 0
  return (-2 * dot(sub(m, midpoint(p0, p1)), perp(chord))) / c2
}

export function compileEdge(outline: Outline, i: number): Segment {
  const n = outline.nodes.length
  const a = outline.nodes[i]
  const b = outline.nodes[(i + 1) % n]
  const edge = outline.edges[i]
  if (edge.kind === 'arc' && Math.abs(edge.bulge) > MIN_BULGE && distance(a.p, b.p) > 0) {
    return arcFromBulge(a.p, b.p, edge.bulge)
  }
  if (edge.kind === 'cubic') {
    return { kind: 'cubic', p0: a.p, p1: add(a.p, a.hOut), p2: add(b.p, b.hIn), p3: b.p }
  }
  return { kind: 'line', p0: a.p, p1: b.p }
}

/** Compile the editable outline into a closed chain of segments, in node order. */
export function compileOutline(outline: Outline): Segment[] {
  return outline.edges.map((_, i) => compileEdge(outline, i))
}

/** Signed area enclosed by a closed chain (positive = CCW). Exact for lines and cubics. */
export function signedArea(segments: Segment[]): number {
  let area = 0
  for (const seg of segments) {
    area += integrate((t) => cross(pointAt(seg, t), derivAt(seg, t)), 0, 1, seg.kind === 'arc' ? 4 : 1) / 2
  }
  return area
}

/** The same closed chain traversed counter-clockwise. */
export function orientCCW(segments: Segment[]): Segment[] {
  if (signedArea(segments) >= 0) return segments
  return segments.map(reverseSegment).reverse()
}

/** Polyline approximation, for validation checks and hit testing only (never for results). */
export function flatten(segments: Segment[], perSegment = 48): Vec2[] {
  const pts: Vec2[] = []
  for (const seg of segments) {
    const count = seg.kind === 'line' ? 1 : perSegment
    for (let i = 0; i < count; i++) pts.push(pointAt(seg, i / count))
  }
  return pts
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0
  return distance(p, add(a, scale(ab, t)))
}

/** Minimum distance from point p to a closed polyline. */
export function distanceToPolyline(p: Vec2, poly: Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, pointSegmentDistance(p, poly[i], poly[(i + 1) % poly.length]))
  }
  return best
}

/** Minimum distance between segment [a, b] and a closed polyline. */
export function segmentDistanceToPolyline(a: Vec2, b: Vec2, poly: Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i]
    const d = poly[(i + 1) % poly.length]
    if (segmentsIntersect(a, b, c, d)) return 0
    best = Math.min(best, pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
  }
  return best
}

/** Even-odd point-in-polygon test. */
export function pointInPolyline(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a))
  const d2 = cross(sub(b, a), sub(d, a))
  const d3 = cross(sub(d, c), sub(a, c))
  const d4 = cross(sub(d, c), sub(b, c))
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** True if a closed polyline crosses itself (adjacent edges are ignored). */
export function polylineSelfIntersects(poly: Vec2[]): boolean {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (segmentsIntersect(a, b, poly[j], poly[(j + 1) % n])) return true
    }
  }
  return false
}

/** Nearest parameter on a segment to point p (coarse sampling + golden-section refinement). */
export function nearestParameter(seg: Segment, p: Vec2): { t: number; distance: number } {
  const samples = 64
  let bestT = 0
  let bestD = Infinity
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const d = distance(pointAt(seg, t), p)
    if (d < bestD) {
      bestD = d
      bestT = t
    }
  }
  let lo = Math.max(0, bestT - 1 / samples)
  let hi = Math.min(1, bestT + 1 / samples)
  const g = (Math.sqrt(5) - 1) / 2
  for (let i = 0; i < 40; i++) {
    const m1 = hi - g * (hi - lo)
    const m2 = lo + g * (hi - lo)
    if (distance(pointAt(seg, m1), p) < distance(pointAt(seg, m2), p)) hi = m2
    else lo = m1
  }
  const t = (lo + hi) / 2
  return { t, distance: distance(pointAt(seg, t), p) }
}
