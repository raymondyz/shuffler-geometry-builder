import { nearestParameter, pointInPolyline } from '../curves/outline'
import { pointAt, type Segment } from '../curves/segment'
import { add, angleOf, cross, dot, neg, normalize, rotate, scale, sub, type Vec2 } from '../math/vec2'
import { obroundCenter, type Circle, type Obround } from './features'
import type { Loop } from './loops'
import { compose, invert, rotation, scaling, translation, type Affine } from './segments'

// Moving the drawing into the foot frame at neutral: P1 at the origin, centreline vertical, slot above (SPEC §14.7).

export interface PlaceOptions {
  /** Extra rotation (radians), used when no slot fixes the centreline */
  rotation: number
  /** Mirror about the centreline */
  flip: boolean
  /** P1 picked by hand, in drawing millimetres */
  pickedP1: Vec2 | null
}

export interface Placement {
  /** Drawing (mm) → foot frame */
  toFoot: Affine
  toDrawing: Affine
  /** True when there is no bore and the drawing origin is outside the foot, so P1 must be picked */
  needsP1: boolean
  /** True when a bore and slot set the centreline, so there is nothing to rotate */
  slotFixed: boolean
}

interface ChainSamples {
  points: Vec2[]
  owner: number[]
}

function sampleChain(segments: Segment[], perCurve: number): ChainSamples {
  const points: Vec2[] = []
  const owner: number[] = []
  segments.forEach((seg, k) => {
    const n = seg.kind === 'line' ? 2 : perCurve
    for (let i = 0; i < n; i++) {
      points.push(pointAt(seg, i / n))
      owner.push(k)
    }
  })
  return { points, owner }
}

/** Distance from p to a closed chain: nearest edge of a fine polyline, refined on the segments that edge touches. */
function distanceToChain(p: Vec2, segments: Segment[], chain: ChainSamples): number {
  const { points, owner } = chain
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const ab = sub(points[(i + 1) % points.length], a)
    const l2 = dot(ab, ab)
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0
    const d = Math.hypot(p.x - a.x - ab.x * t, p.y - a.y - ab.y * t)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  const candidates = new Set([owner[best], owner[(best + 1) % points.length]])
  let exact = Infinity
  for (const k of candidates) exact = Math.min(exact, nearestParameter(segments[k], p).distance)
  return Math.min(exact, bestD)
}

/**
 * Largest distance between a closed chain and its mirror image about the line through `at` along
 * `axis`. Stops early once it exceeds `limit`.
 */
export function symmetryError(segments: Segment[], at: Vec2, axis: Vec2, limit = Infinity): number {
  const u = normalize(axis)
  const chain = sampleChain(segments, 64)
  const probes = sampleChain(segments, 24).points
  let worst = 0
  for (const q of probes) {
    const d = sub(q, at)
    const mirrored = add(at, sub(scale(u, 2 * dot(d, u)), d))
    worst = Math.max(worst, distanceToChain(mirrored, segments, chain))
    if (worst > limit) return worst
  }
  return worst
}

function polygonMoments(poly: Vec2[]): { centroid: Vec2; axes: Vec2[] } | null {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const c = cross(p, q)
    a += c
    cx += (p.x + q.x) * c
    cy += (p.y + q.y) * c
  }
  if (Math.abs(a) < 1e-12) return null
  const centroid = { x: cx / (3 * a), y: cy / (3 * a) }
  let ixx = 0
  let iyy = 0
  let ixy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = sub(poly[i], centroid)
    const q = sub(poly[(i + 1) % poly.length], centroid)
    const c = cross(p, q)
    ixx += (p.y * p.y + p.y * q.y + q.y * q.y) * c
    iyy += (p.x * p.x + p.x * q.x + q.x * q.x) * c
    ixy += (p.x * q.y + 2 * p.x * p.y + 2 * q.x * q.y + q.x * p.y) * c
  }
  // ixx = 12·∫y², iyy = 12·∫x², ixy = 24·∫xy. Nearly equal moments (a circle, a square) say nothing about axes.
  if (Math.hypot(ixx - iyy, ixy) < 1e-6 * (Math.abs(ixx) + Math.abs(iyy))) return { centroid, axes: [] }
  const theta = 0.5 * Math.atan2(ixy, iyy - ixx)
  const u = { x: Math.cos(theta), y: Math.sin(theta) }
  return { centroid, axes: [u, { x: -u.y, y: u.x }] }
}

const AXIS_TOL = 0.05

/** The outline's mirror axis through P1, if it has one, pointing the way nearer the drawing's +Y. */
function mirrorAxis(outline: Loop, p1: Vec2): Vec2 | null {
  const m = polygonMoments(outline.polyline)
  if (!m) return null
  for (const u of m.axes) {
    if (Math.abs(cross(u, sub(p1, m.centroid))) > AXIS_TOL) continue
    if (symmetryError(outline.segments, m.centroid, u, AXIS_TOL) <= AXIS_TOL) return u.y < 0 || (u.y === 0 && u.x > 0) ? neg(u) : u
  }
  return null
}

function centroidOf(poly: Vec2[]): Vec2 {
  return polygonMoments(poly)?.centroid ?? poly[0] ?? { x: 0, y: 0 }
}

/** Rigid placement of a foot outline (plus the unit scale already applied) into the foot frame. */
export function placeFoot(outline: Loop, bore: Circle | null, slot: Obround | null, options: PlaceOptions): Placement {
  const origin = { x: 0, y: 0 }
  const known = bore?.center ?? options.pickedP1 ?? (pointInPolyline(origin, outline.polyline) ? origin : null)
  const p1 = known ?? centroidOf(outline.polyline)
  const slotFixed = bore !== null && slot !== null
  const dir = slotFixed ? normalize(sub(obroundCenter(slot), p1)) : rotate(mirrorAxis(outline, p1) ?? { x: 0, y: 1 }, options.rotation)
  let toFoot = compose(rotation(Math.PI / 2 - angleOf(dir)), translation(neg(p1)))
  if (options.flip) toFoot = compose(scaling(-1, 1), toFoot)
  return { toFoot, toDrawing: invert(toFoot), needsP1: known === null, slotFixed }
}
