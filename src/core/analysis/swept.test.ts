import { describe, expect, it } from 'vitest'
import { flatten, type Outline } from '../curves/outline'
import { createDefaultDesign } from '../design/defaults'
import { camRadius } from '../design/hardware'
import { footPresets, presetContext } from '../design/presets'
import type { Design } from '../design/schema'
import { TAU } from '../math/angle'
import { rotate, type Vec2 } from '../math/vec2'
import type { CubicBezier } from '../spline/curve'
import { mulberry32, randomOutline } from '../test/helpers'
import { analyzeDesign } from './analyze'

const RAYS = 1440
const POSES = 2000

const withOutline = (design: Design, outline: Outline): Design => ({ ...design, foot: { outline, mirror: false } })

/** Raises R[m] to the farthest point where ray m (angle −π + m·2π/RAYS from P0) crosses the closed polygon. */
function rasterizeClosed(poly: Vec2[], R: Float64Array) {
  const dTheta = TAU / RAYS
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ta = Math.atan2(a.y, a.x)
    let span = Math.atan2(b.y, b.x) - ta
    span -= TAU * Math.round(span / TAU)
    const lo = Math.min(ta, ta + span)
    const hi = Math.max(ta, ta + span)
    for (let m = Math.ceil((lo + Math.PI) / dTheta); m <= Math.floor((hi + Math.PI) / dTheta); m++) {
      const k = ((m % RAYS) + RAYS) % RAYS
      const ex = Math.cos(-Math.PI + k * dTheta)
      const ey = Math.sin(-Math.PI + k * dTheta)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-15) continue
      const s = -(a.x * ey - a.y * ex) / den
      if (s < -1e-9 || s > 1 + 1e-9) continue
      R[k] = Math.max(R[k], (a.x + s * dx) * ex + (a.y + s * dy) * ey)
    }
  }
}

/**
 * Ground truth: the union of POSES poses of the finely flattened outline, plus the cam disc's sweep.
 * Sharp corners also get their own paths: between sampled poses a corner leaves notches that shrink
 * only linearly with the pose spacing, while its path is accurate to second order.
 */
function bruteForce(design: Design): Float64Array {
  const analysis = analyzeDesign(design)
  const model = analysis.kinematics!.model
  const poly = flatten(analysis.outline!.ccw, 400)
  const corners = poly.filter((q, i) => {
    const a = poly[(i - 1 + poly.length) % poly.length]
    const b = poly[(i + 1) % poly.length]
    const turn = Math.atan2((q.x - a.x) * (b.y - q.y) - (q.y - a.y) * (b.x - q.x), (q.x - a.x) * (b.x - q.x) + (q.y - a.y) * (b.y - q.y))
    return Math.abs(turn) > 0.1
  })
  const poses = Array.from({ length: POSES }, (_, j) => model.sample((j * TAU) / POSES))
  const place = (q: Vec2, s: (typeof poses)[number]) => {
    const r = rotate(q, s.alpha)
    return { x: s.p1.x + r.x, y: s.p1.y + r.y }
  }
  const R = new Float64Array(RAYS).fill(design.drive.L + camRadius(design))
  for (const s of poses) rasterizeClosed(poly.map((q) => place(q, s)), R)
  for (const c of corners) rasterizeClosed(poses.map((s) => place(c, s)), R)
  return R
}

function bezierPoint(b: CubicBezier, t: number): Vec2 {
  const u = 1 - t
  const k0 = u * u * u
  const k1 = 3 * u * u * t
  const k2 = 3 * u * t * t
  const k3 = t * t * t
  return {
    x: k0 * b.p0.x + k1 * b.p1.x + k2 * b.p2.x + k3 * b.p3.x,
    y: k0 * b.p0.y + k1 * b.p1.y + k2 * b.p2.y + k3 * b.p3.y,
  }
}

function boundaryRadii(boundary: CubicBezier[]): Float64Array {
  const pts = boundary.flatMap((b) => Array.from({ length: 64 }, (_, i) => bezierPoint(b, i / 64)))
  const R = new Float64Array(RAYS).fill(-Infinity)
  rasterizeClosed(pts, R)
  return R
}

/** Largest radial gap between the computed boundary and the brute-force union, ray by ray (mm). */
function worstGap(design: Design): { gap: number; exact: boolean; boundary: CubicBezier[] } {
  const swept = analyzeDesign(design).swept()
  expect(swept).not.toBeNull()
  const ours = boundaryRadii(swept!.boundary)
  const truth = bruteForce(design)
  let gap = 0
  for (let m = 0; m < RAYS; m++) gap = Math.max(gap, Math.abs(ours[m] - truth[m]))
  return { gap, exact: swept!.exact, boundary: swept!.boundary }
}

describe('swept area (SPEC §4.6)', () => {
  const base = createDefaultDesign()

  it('is a circle of radius R + L for a circular foot', () => {
    const circle: Outline = {
      nodes: [
        { id: 'a', p: { x: 0, y: -60 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 }, mode: 'corner' },
        { id: 'b', p: { x: 0, y: 60 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 }, mode: 'corner' },
      ],
      edges: [{ kind: 'arc', bulge: 1 }, { kind: 'arc', bulge: 1 }],
    }
    const swept = analyzeDesign(withOutline(base, circle)).swept()!
    expect(swept.exact).toBe(true)
    for (const b of swept.boundary) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const p = bezierPoint(b, t)
        expect(Math.abs(Math.hypot(p.x, p.y) - 66)).toBeLessThan(1e-4)
      }
    }
  })

  it('matches the brute-force union of poses for the default foot', () => {
    const { gap, exact } = worstGap(base)
    expect(exact).toBe(true)
    expect(gap).toBeLessThan(1e-3)
  })

  it('matches the brute-force union of poses for every preset', () => {
    for (const preset of footPresets) {
      const { gap, exact } = worstGap(withOutline(base, preset.create(presetContext(base), 50)))
      expect(exact, preset.id).toBe(true)
      expect(gap, preset.id).toBeLessThan(1e-3)
    }
  })

  it('matches the brute-force union for random feet and a tilted pin', () => {
    const rand = mulberry32(5)
    const tilted: Design = { ...base, drive: { kind: 'eccentric', L: 9 }, constraint: { kind: 'centerlineSlot', pin: { x: 12, y: 38 } } }
    for (let trial = 0; trial < 6; trial++) {
      const { gap } = worstGap(withOutline(tilted, randomOutline(rand, 6 + trial, 55, 0.5)))
      expect(gap, `trial ${trial}`).toBeLessThan(1e-3)
    }
  })

  it('flags a hooked foot as conservative, and still bounds every pose', () => {
    // A foot with a hook curling back toward the shaft: not star-shaped about P0
    const pts: Vec2[] = [
      { x: -40, y: -50 }, { x: 40, y: -50 }, { x: 40, y: 55 }, { x: -10, y: 55 },
      { x: -10, y: 70 }, { x: 25, y: 70 }, { x: 25, y: 62 }, { x: 33, y: 62 }, { x: 33, y: 80 }, { x: -40, y: 80 },
    ]
    const hook: Outline = {
      nodes: pts.map((p, i) => ({ id: `h${i}`, p, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 }, mode: 'corner' })),
      edges: pts.map(() => ({ kind: 'line' as const, bulge: 0 })),
    }
    const { gap, exact } = worstGap(withOutline(base, hook))
    expect(exact).toBe(false)
    expect(gap).toBeLessThan(1e-3)
  })

  it('includes the cam disc where it pokes out of the foot', () => {
    const bigShaft: Design = { ...base, hardware: { ...base.hardware, shaft: { kind: 'round', size: 80 } } }
    const reach = bigShaft.drive.L + camRadius(bigShaft)
    const { gap, boundary } = worstGap(bigShaft)
    expect(gap).toBeLessThan(1e-3)
    // Radii of the Bézier ends and midpoints (curve points, not chords)
    const radii = boundary.flatMap((b) => [0, 0.5].map((t) => Math.hypot(bezierPoint(b, t).x, bezierPoint(b, t).y)))
    expect(Math.min(...radii)).toBeGreaterThan(reach - 1e-4)
    expect(radii.filter((r) => Math.abs(r - reach) < 1e-4).length).toBeGreaterThan(4)
    expect(Math.max(...radii)).toBeGreaterThan(reach + 1)
  })

  it('is closed and counter-clockwise', () => {
    const { boundary } = analyzeDesign(base).swept()!
    for (let i = 0; i < boundary.length; i++) {
      const next = boundary[(i + 1) % boundary.length]
      expect(Math.hypot(boundary[i].p3.x - next.p0.x, boundary[i].p3.y - next.p0.y)).toBeLessThan(1e-9)
    }
    const area = boundary.reduce((sum, b) => {
      const pts = Array.from({ length: 9 }, (_, i) => bezierPoint(b, i / 8))
      return sum + pts.slice(1).reduce((s, p, i) => s + (pts[i].x * p.y - p.x * pts[i].y) / 2, 0)
    }, 0)
    expect(area).toBeGreaterThan(0)
  })
})
