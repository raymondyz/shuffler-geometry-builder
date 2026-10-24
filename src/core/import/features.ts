import { flatten } from '../curves/outline'
import type { ArcSegment, Segment } from '../curves/segment'
import { TAU } from '../math/angle'
import { add, cross, distance, dot, length, midpoint, perp, scale, sub, type Vec2 } from '../math/vec2'
import type { Loop } from './loops'
import { mergeLoop } from './segments'

// Recognising the bore and the slot among a foot's holes (SPEC §14.6).

export interface Circle {
  center: Vec2
  radius: number
}

/** A stadium: the pin circle swept from c1 to c2 */
export interface Obround {
  c1: Vec2
  c2: Vec2
  radius: number
}

export const obroundCenter = (o: Obround): Vec2 => midpoint(o.c1, o.c2)

const REL_TOL = 1e-6
/** Faceted holes: allowed deviation from the ideal shape, relative to its radius */
const FACETED_TOL = 0.01

/** Points along a loop for shape fits: every vertex and the middle of every line, plus samples on curves. */
function samplePoints(loop: Loop): Vec2[] {
  return loop.segments.flatMap((s) => (s.kind === 'line' ? [s.p0, midpoint(s.p0, s.p1)] : flatten([s], 16)))
}

/** Least-squares circle (Kåsa) through points, centred first for accuracy. */
function fitCircle(points: Vec2[]): Circle | null {
  const n = points.length
  const mean = scale(points.reduce(add, { x: 0, y: 0 }), 1 / n)
  let suu = 0
  let suv = 0
  let svv = 0
  let suuu = 0
  let svvv = 0
  let suvv = 0
  let svuu = 0
  for (const p of points) {
    const u = p.x - mean.x
    const v = p.y - mean.y
    suu += u * u
    suv += u * v
    svv += v * v
    suuu += u * u * u
    svvv += v * v * v
    suvv += u * v * v
    svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-18) return null
  const bu = (suuu + suvv) / 2
  const bv = (svvv + svuu) / 2
  const uc = (bu * svv - bv * suv) / det
  const vc = (bv * suu - bu * suv) / det
  const center = add(mean, { x: uc, y: vc })
  return { center, radius: Math.sqrt(uc * uc + vc * vc + (suu + svv) / n) }
}

const isArc = (s: Segment): s is ArcSegment => s.kind === 'arc'

const sameCircle = (a: ArcSegment, b: ArcSegment) =>
  distance(a.center, b.center) <= REL_TOL * a.radius + 1e-9 && Math.abs(a.radius - b.radius) <= REL_TOL * a.radius + 1e-9

/** A loop that is a full circle: arcs of one circle adding up to 360°, or a fine polygon on a circle. */
export function circleOf(loop: Loop): Circle | null {
  const segs = loop.segments
  if (segs.every(isArc)) {
    const first = segs[0] as ArcSegment
    const total = segs.reduce((t, s) => t + Math.abs((s as ArcSegment).sweep), 0)
    if (segs.every((s) => sameCircle(first, s as ArcSegment)) && Math.abs(total - TAU) < 1e-6) {
      return { center: first.center, radius: first.radius }
    }
    return null
  }
  if (segs.length < 12) return null
  const points = samplePoints(loop)
  const c = fitCircle(points)
  if (!c || !(c.radius > 0)) return null
  return points.every((p) => Math.abs(distance(p, c.center) - c.radius) <= FACETED_TOL * c.radius) ? c : null
}

function exactObround(loop: Loop): Obround | null {
  const segs = mergeLoop(loop.segments)
  if (segs.length !== 4) return null
  for (let k = 0; k < 2; k++) {
    const [a1, l1, a2, l2] = [segs[k], segs[k + 1], segs[(k + 2) % 4], segs[(k + 3) % 4]]
    if (!isArc(a1) || !isArc(a2) || l1.kind !== 'line' || l2.kind !== 'line') continue
    const r = a1.radius
    if (Math.abs(a2.radius - r) > REL_TOL * r) return null
    if (Math.abs(Math.abs(a1.sweep) - Math.PI) > 1e-6 || Math.abs(Math.abs(a2.sweep) - Math.PI) > 1e-6) return null
    const d = distance(a1.center, a2.center)
    if (!(d > REL_TOL * r)) return null
    const fits = (l: Segment) => l.kind === 'line' && Math.abs(distance(l.p0, l.p1) - d) <= REL_TOL * (d + r) + 1e-9
    return fits(l1) && fits(l2) ? { c1: a1.center, c2: a2.center, radius: r } : null
  }
  return null
}

/** Principal axis of a point set (its direction of greatest spread). */
function principalAxis(points: Vec2[]): { mean: Vec2; axis: Vec2 } {
  const mean = scale(points.reduce(add, { x: 0, y: 0 }), 1 / points.length)
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of points) {
    const d = sub(p, mean)
    sxx += d.x * d.x
    sxy += d.x * d.y
    syy += d.y * d.y
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { mean, axis: { x: Math.cos(theta), y: Math.sin(theta) } }
}

/** Faceted (or otherwise drawn) stadium: fitted along its principal axis, then checked point by point. */
function fittedObround(loop: Loop): Obround | null {
  if (loop.segments.length < 12) return null
  const points = samplePoints(loop)
  const { mean, axis } = principalAxis(points)
  const n = perp(axis)
  let s0 = Infinity
  let s1 = -Infinity
  let t0 = Infinity
  let t1 = -Infinity
  for (const p of points) {
    const d = sub(p, mean)
    s0 = Math.min(s0, dot(d, axis))
    s1 = Math.max(s1, dot(d, axis))
    t0 = Math.min(t0, dot(d, n))
    t1 = Math.max(t1, dot(d, n))
  }
  const radius = (t1 - t0) / 2
  const straight = s1 - s0 - 2 * radius
  if (!(radius > 0) || straight < 0.05 * radius) return null
  const center = add(mean, add(scale(axis, (s0 + s1) / 2), scale(n, (t0 + t1) / 2)))
  const c1 = add(center, scale(axis, -straight / 2))
  const c2 = add(center, scale(axis, straight / 2))
  const toCore = (p: Vec2) => {
    const t = Math.max(0, Math.min(1, dot(sub(p, c1), sub(c2, c1)) / (straight * straight)))
    return distance(p, add(c1, scale(sub(c2, c1), t)))
  }
  return points.every((p) => Math.abs(toCore(p) - radius) <= 1.5 * FACETED_TOL * radius) ? { c1, c2, radius } : null
}

/** A loop shaped like a slot (two half circles joined by straight sides), exact or faceted. */
export function obroundOf(loop: Loop): Obround | null {
  return exactObround(loop) ?? fittedObround(loop)
}

export interface Features {
  bore: Circle | null
  slot: Obround | null
  /** How far the slot's axis misses the bore centre, when it does (an offset or angled slot) */
  slotOffset: { distance: number; angle: number } | null
  /** Holes that are neither: lightening holes, bolt holes, curved slots, engraved text */
  others: number
}

const OFFSET_TOL = 0.05
const ANGLE_TOL = (0.5 * Math.PI) / 180

function axisMiss(bore: Circle, slot: Obround): { distance: number; angle: number } {
  const axis = sub(slot.c2, slot.c1)
  const u = scale(axis, 1 / length(axis))
  const toSlot = sub(obroundCenter(slot), bore.center)
  const miss = Math.abs(cross(u, sub(bore.center, slot.c1)))
  const along = length(toSlot)
  const angle = along > 0 ? Math.acos(Math.min(1, Math.abs(dot(u, toSlot)) / along)) : 0
  return { distance: miss, angle }
}

/** Find the bore and slot among a part's holes: the pair whose axis lines up best, else the largest circle. */
export function findFeatures(holes: Loop[]): Features {
  const circles = holes.map(circleOf)
  const slots = holes.map((h, i) => (circles[i] ? null : obroundOf(h)))
  let bore: Circle | null = null
  let slot: Obround | null = null
  let bestMiss = Infinity
  for (const c of circles) {
    if (!c) continue
    for (const s of slots) {
      if (!s) continue
      const miss = axisMiss(c, s).distance
      if (miss < bestMiss - 1e-9 || (Math.abs(miss - bestMiss) <= 1e-9 && bore !== null && c.radius > bore.radius)) {
        bestMiss = miss
        bore = c
        slot = s
      }
    }
  }
  if (!bore) {
    for (const c of circles) if (c && (!bore || c.radius > bore.radius)) bore = c
  }
  const used = (bore ? 1 : 0) + (slot ? 1 : 0)
  let slotOffset: Features['slotOffset'] = null
  if (bore && slot) {
    const miss = axisMiss(bore, slot)
    if (miss.distance > OFFSET_TOL || miss.angle > ANGLE_TOL) slotOffset = miss
  }
  return { bore, slot, slotOffset, others: holes.length - used }
}

/** Arc centres of a loop: snap targets when picking P1 by hand. */
export const arcCenters = (loop: Loop): Vec2[] => loop.segments.flatMap((s) => (s.kind === 'arc' ? [s.center] : []))
