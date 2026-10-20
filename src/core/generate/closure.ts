import type { Outline, OutlineEdge, OutlineNode } from '../curves/outline'
import { symmetrize } from '../design/mirror'
import { newNodeId } from '../design/presets'
import type { Hardware } from '../design/schema'
import { TAU } from '../math/angle'
import { add, distance, scale, sub, type Vec2 } from '../math/vec2'
import { evalPiece2D, piece2DToBezier, type CubicBezier, type HermitePiece2D, type Sample2D } from '../spline/curve'
import { EXTENSION_RADIUS, footDiscs, type MechanismChoice } from './inner'
import { evaluateProfile, type Profile } from './profile'

const CONTACT_FIT_TOL = 0.05
const MAX_DEPTH = 12
const SWEEP_STEP = (0.5 * Math.PI) / 180

const n = (psi: number): Vec2 => ({ x: Math.cos(psi), y: Math.sin(psi) })
const nd = (psi: number): Vec2 => ({ x: -Math.sin(psi), y: Math.cos(psi) })

/** One piece of the closed boundary, in CCW order */
type Piece =
  | { kind: 'cubic'; bezier: CubicBezier }
  | { kind: 'arc'; from: Vec2; to: Vec2; sweep: number }
  | { kind: 'line'; from: Vec2; to: Vec2 }

/** A convex element of the hull: its support value and support point in direction ψ */
interface Element {
  support(psi: number): number
  point(psi: number): Vec2
}

/**
 * Full foot outline around a solved contact profile (SPEC §10.8). The contact curve covers every
 * direction that ever points at the ground; beyond its ends it continues as small arcs until a common
 * tangent reaches the bore or slot discs (wall included). The rest is the convex hull of those pieces:
 * tangent lines and disc arcs. Convex, so nothing outside the contact band can touch the ground.
 */
export function closeOutline(profile: Profile, x: ArrayLike<number>, mech: MechanismChoice, hardware: Hardware, symmetric: boolean): { outline: Outline; mirror: boolean } {
  const { lo, hi } = profile
  const at = (psi: number) => evaluateProfile(profile, x, psi)
  const qLo = at(lo)
  const qHi = at(hi)
  const rLo = Math.min(qLo.rho, EXTENSION_RADIUS)
  const rHi = Math.min(qHi.rho, EXTENSION_RADIUS)
  // How far the end arcs may turn: enough to reach a tangent to any disc above
  const ext = Math.PI
  const end = lo + TAU
  /** Right end arc at outward normal ψ ∈ (hi, hi + ext], left end arc at ψ ∈ [end − ext, end) */
  const rightArc = (psi: number) => add(qHi.q, scale(sub(n(Math.min(psi, hi + ext)), n(hi)), rHi))
  const leftArc = (psi: number) => add(qLo.q, scale(sub(n(Math.max(psi, end - ext)), n(lo)), rLo))

  // The contact curve plus its end arcs, as one convex set: its support point in direction ψ
  const curvePoint = (psiIn: number): Vec2 => {
    let psi = psiIn
    while (psi < lo) psi += TAU
    while (psi >= end) psi -= TAU
    if (psi <= hi) return at(psi).q
    const a = rightArc(psi)
    const b = leftArc(psi)
    const d = n(psi)
    return a.x * d.x + a.y * d.y >= b.x * d.x + b.y * d.y ? a : b
  }
  const curve: Element = {
    point: curvePoint,
    support: (psi) => { const p = curvePoint(psi); return p.x * Math.cos(psi) + p.y * Math.sin(psi) },
  }
  const discs: Element[] = footDiscs(mech, hardware).map(({ c, r }) => ({
    point: (psi) => add(c, scale(n(psi), r)),
    support: (psi) => c.x * Math.cos(psi) + c.y * Math.sin(psi) + r,
  }))
  const elements = [curve, ...discs]
  const winner = (psi: number) => {
    let best = 0
    let value = curve.support(psi)
    for (let i = 1; i < elements.length; i++) {
      const v = elements[i].support(psi)
      if (v > value + 1e-12) {
        best = i
        value = v
      }
    }
    return best
  }

  // Sweep the directions outside the band and record which element forms the hull
  const runs: { element: number; from: number; to: number }[] = []
  let current = winner(hi)
  let from = hi
  for (let psi = hi + SWEEP_STEP; ; psi += SWEEP_STEP) {
    const p = Math.min(psi, end)
    const w = winner(p)
    if (w !== current) {
      // Bisect for the direction where the two elements' supports are equal (their common tangent)
      let a = p - SWEEP_STEP
      let b = p
      for (let i = 0; i < 60; i++) {
        const m = (a + b) / 2
        if (elements[current].support(m) >= elements[w].support(m)) a = m
        else b = m
      }
      runs.push({ element: current, from, to: (a + b) / 2 })
      current = w
      from = (a + b) / 2
    }
    if (p >= end) break
  }
  runs.push({ element: current, from, to: end })

  // Contact curve as smooth, strictly convex cubics
  const pieces: Piece[] = fitConvex((psi) => { const v = at(psi); return { p: v.q, d: scale(nd(psi), v.rho) } }, lo, hi)
    .map((p) => ({ kind: 'cubic', bezier: piece2DToBezier(p) }))

  let cursor = qHi.q
  const lineTo = (p: Vec2) => {
    if (distance(cursor, p) > 1e-7) pieces.push({ kind: 'line', from: cursor, to: p })
    cursor = p
  }
  const arcTo = (p: Vec2, sweep: number) => {
    if (sweep > 1e-7 && distance(cursor, p) > 1e-7) pieces.push({ kind: 'arc', from: cursor, to: p, sweep })
    cursor = p
  }
  for (const run of runs) {
    if (run.element === 0) {
      // The contact curve's end arcs: the right one leaves the band, the left one returns to it
      if (run.from <= hi + 1e-12) {
        const stop = Math.min(run.to, hi + ext)
        arcTo(rightArc(stop), stop - hi)
      }
      if (run.to >= end - 1e-12) {
        const startAt = Math.max(run.from, end - ext)
        lineTo(leftArc(startAt))
        arcTo(qLo.q, end - startAt)
      } else if (run.from > hi + 1e-12) {
        lineTo(curvePoint(run.from))
      }
      continue
    }
    const el = elements[run.element]
    lineTo(el.point(run.from))
    arcTo(el.point(run.to), run.to - run.from)
  }
  lineTo(qLo.q)

  const outline = toOutline(pieces)
  const mirrored = symmetric ? symmetrize(outline) : null
  return mirrored ? { outline: mirrored, mirror: true } : { outline, mirror: false }
}

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x

/**
 * True if the cubic turns left everywhere (no inflection). B′ × B″ is a quadratic in t
 * (−(a×b)t² + (c×a)t + c×b, with B′/3 = at² + 2bt + c), so checking its ends and vertex is exact.
 */
function convexBezier(z: CubicBezier): boolean {
  const d0 = sub(z.p1, z.p0)
  const d1 = sub(z.p2, z.p1)
  const d2 = sub(z.p3, z.p2)
  const a = { x: d0.x - 2 * d1.x + d2.x, y: d0.y - 2 * d1.y + d2.y }
  const b = sub(d1, d0)
  const c = d0
  const A = -cross(a, b)
  const B = cross(c, a)
  const C = cross(c, b)
  const f = (t: number) => (A * t + B) * t + C
  const ts = [0, 1]
  if (Math.abs(A) > 1e-300) {
    const v = -B / (2 * A)
    if (v > 0 && v < 1) ts.push(v)
  }
  return ts.every((t) => f(t) > 0)
}

/** Adaptive Hermite fit (exact ends and tangents) that also splits until every piece is convex. */
function fitConvex(f: (t: number) => Sample2D, a: number, b: number): HermitePiece2D[] {
  const out: HermitePiece2D[] = []
  const fit = (t0: number, s0: Sample2D, t1: number, s1: Sample2D, depth: number) => {
    const piece = { t0, t1, p0: s0.p, p1: s1.p, d0: s0.d, d1: s1.d }
    const tm = (t0 + t1) / 2
    const mid = f(tm)
    let worst = 0
    for (const c of [0.25, 0.5, 0.75]) {
      const t = t0 + (t1 - t0) * c
      worst = Math.max(worst, distance(c === 0.5 ? mid.p : f(t).p, evalPiece2D(piece, t)))
    }
    if (depth >= MAX_DEPTH || (worst <= CONTACT_FIT_TOL && convexBezier(piece2DToBezier(piece)))) {
      out.push(piece)
      return
    }
    fit(t0, s0, tm, mid, depth + 1)
    fit(tm, mid, t1, s1, depth + 1)
  }
  fit(a, f(a), b, f(b), 0)
  return out
}

const ZERO: Vec2 = { x: 0, y: 0 }

/** Editable outline from boundary pieces: one node per piece start, handles only on cubic sides. */
function toOutline(pieces: Piece[]): Outline {
  const startOf = (p: Piece) => (p.kind === 'cubic' ? p.bezier.p0 : p.from)
  const nodes: OutlineNode[] = pieces.map((p) => ({ id: newNodeId(), p: startOf(p), hIn: ZERO, hOut: ZERO, mode: 'corner' }))
  const edges: OutlineEdge[] = pieces.map((p, i) => {
    if (p.kind === 'cubic') {
      const next = nodes[(i + 1) % nodes.length]
      nodes[i] = { ...nodes[i], hOut: sub(p.bezier.p1, p.bezier.p0) }
      nodes[(i + 1) % nodes.length] = { ...next, hIn: sub(p.bezier.p2, p.bezier.p3) }
      return { kind: 'cubic', bulge: 0 }
    }
    if (p.kind === 'arc') return { kind: 'arc', bulge: Math.tan(p.sweep / 4) }
    return { kind: 'line', bulge: 0 }
  })
  // Anchors between two cubics keep their handles aligned when edited
  for (let i = 0; i < nodes.length; i++) {
    const before = edges[(i - 1 + nodes.length) % nodes.length].kind
    if (before === 'cubic' && edges[i].kind === 'cubic') nodes[i] = { ...nodes[i], mode: 'smooth' }
  }
  return { nodes, edges }
}
