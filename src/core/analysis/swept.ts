import { derivAt, deriv2At, endTangent, pointAt, startTangent, type Segment } from '../curves/segment'
import { TAU, wrapPi } from '../math/angle'
import { brent } from '../math/roots'
import { cross, dot, length, type Vec2 } from '../math/vec2'
import type { TiltConstraint } from '../mechanism/constraints/types'
import type { Drive } from '../mechanism/drive'
import { fitCurve2D, piece2DToBezier, type CubicBezier, type Sample2D } from '../spline/curve'

/** Everything one foot and its cam occupy over a revolution, in the body frame (SPEC §4.6). */
export interface SweptArea {
  /** Outer boundary: a closed counter-clockwise loop of cubic Béziers */
  boundary: CubicBezier[]
  /**
   * True when every pose of the foot is star-shaped about P0, so the boundary is exact. Otherwise it
   * bounds the radial hull of the swept area: slightly larger, never smaller.
   */
  exact: boolean
}

const PHI_ROWS = 360
const RAYS = 720
const FIT_TOL = 1e-4
const RESIDUAL_TOL = 1e-10
const MAX_NEWTON = 60
/** A ray's seed from another branch is solved exactly when it might be within this of the current one (mm) */
const SEED_SLACK = 0.5
/** Rays to look back when a branch change is found late */
const MAX_BACKTRACK = 8

// ---------------------------------------------------------------------------------------------
// The outline as a loop of pieces (SPEC §11.10 step 1). Corner pieces have zero length and turn the
// normal from the incoming to the outgoing direction, which keeps g(σ, φ) continuous around Γ.

interface LoopPiece {
  seg: Segment | null
  /** Corner pieces: the corner point, the normal where the turn starts and the signed turn */
  corner: Vec2
  n0: Vec2
  turn: number
  columns: number
}

/** Point, derivative, unit outward normal and its derivative at local parameter t. */
interface Local {
  q: Vec2
  qd: Vec2
  n: Vec2
  nd: Vec2
}

// Outward normal of a CCW outline: the tangent turned −90°
const normalOf = (d: Vec2): Vec2 => {
  const l = length(d)
  return l > 0 ? { x: d.y / l, y: -d.x / l } : { x: 0, y: 0 }
}

const segmentLength = (seg: Segment): number => {
  switch (seg.kind) {
    case 'line':
      return length({ x: seg.p1.x - seg.p0.x, y: seg.p1.y - seg.p0.y })
    case 'arc':
      return Math.abs(seg.radius * seg.sweep)
    case 'cubic':
      return length({ x: seg.p1.x - seg.p0.x, y: seg.p1.y - seg.p0.y })
        + length({ x: seg.p2.x - seg.p1.x, y: seg.p2.y - seg.p1.y })
        + length({ x: seg.p3.x - seg.p2.x, y: seg.p3.y - seg.p2.y })
  }
}

const columnsFor = (seg: Segment): number => {
  if (seg.kind === 'cubic') return 48
  if (seg.kind === 'arc') return Math.max(4, Math.ceil(Math.abs(seg.sweep) / (Math.PI / 48)))
  return 4
}

function buildLoop(ccw: Segment[]): LoopPiece[] {
  const segs = ccw.filter((s) => segmentLength(s) > 1e-9)
  const loop: LoopPiece[] = []
  const none = { x: 0, y: 0 }
  segs.forEach((seg, i) => {
    loop.push({ seg, corner: none, n0: none, turn: 0, columns: columnsFor(seg) })
    const next = segs[(i + 1) % segs.length]
    const nEnd = normalOf(endTangent(seg))
    const nStart = normalOf(startTangent(next))
    const turn = Math.atan2(cross(nEnd, nStart), dot(nEnd, nStart))
    if (Math.abs(turn) > 1e-9) loop.push({ seg: null, corner: pointAt(next, 0), n0: nEnd, turn, columns: 4 })
  })
  return loop
}

function localAt(piece: LoopPiece, t: number): Local {
  if (!piece.seg) {
    const a = piece.turn * t
    const c = Math.cos(a)
    const s = Math.sin(a)
    const n = { x: c * piece.n0.x - s * piece.n0.y, y: s * piece.n0.x + c * piece.n0.y }
    return { q: piece.corner, qd: { x: 0, y: 0 }, n, nd: { x: -piece.turn * n.y, y: piece.turn * n.x } }
  }
  const seg = piece.seg
  const q = pointAt(seg, t)
  const d = derivAt(seg, t)
  const speed = length(d)
  if (!(speed > 1e-12)) {
    // Zero-length cubic handle at an end: use the limiting tangent
    return { q, qd: d, n: normalOf(t < 0.5 ? startTangent(seg) : endTangent(seg)), nd: { x: 0, y: 0 } }
  }
  const tx = d.x / speed
  const ty = d.y / speed
  const dd = deriv2At(seg, t)
  const along = dd.x * tx + dd.y * ty
  const tdx = (dd.x - along * tx) / speed
  const tdy = (dd.y - along * ty) / speed
  return { q, qd: d, n: { x: ty, y: -tx }, nd: { x: tdy, y: -tdx } }
}

// ---------------------------------------------------------------------------------------------
// The foot's pose and motion at cam angle φ

interface Pose {
  p1: Vec2
  p1d: Vec2
  p1dd: Vec2
  cos: number
  sin: number
  /** α′ and α″ */
  a1: number
  a2: number
}

type PoseFn = (phi: number) => Pose

function poseFn(drive: Drive, constraint: TiltConstraint): PoseFn {
  return (phi) => {
    const { alpha, d1, d2 } = constraint.tilt(phi)
    return {
      p1: drive.p1(phi),
      p1d: drive.p1d(phi),
      p1dd: drive.p1dd(phi),
      cos: Math.cos(alpha),
      sin: Math.sin(alpha),
      a1: d1,
      a2: d2,
    }
  }
}

/** R(α) v */
const rot = (p: Pose, v: Vec2): Vec2 => ({ x: p.cos * v.x - p.sin * v.y, y: p.sin * v.x + p.cos * v.y })
/** R(−α) v */
const unrot = (p: Pose, v: Vec2): Vec2 => ({ x: p.cos * v.x + p.sin * v.y, y: -p.sin * v.x + p.cos * v.y })

/** Body-frame position of foot point q */
const place = (p: Pose, q: Vec2): Vec2 => {
  const r = rot(p, q)
  return { x: p.p1.x + r.x, y: p.p1.y + r.y }
}

// ---------------------------------------------------------------------------------------------
// Exact boundary points: Newton's method on {W(σ, φ) on the ray θ, g(σ, φ) = 0} (SPEC §11.10 step 5)

interface FootState {
  piece: number
  t: number
  phi: number
}

/** Where a solution came from: a point of the foot outline at a pose, or the cam disc's sweep */
type Seed = FootState | 'cam'

interface Solution {
  seed: Seed
  p: Vec2
  r: number
  /** Unit tangent of the candidate curve through p */
  tangent: Vec2
}

interface Solver {
  solve(theta: number, seed: Seed): Solution | null
  /** Exact derivative dW/dθ of the boundary through a solution */
  derivative(sol: Solution, theta: number): Vec2
}

function createSolver(loop: LoopPiece[], pose: PoseFn, camReach: number): Solver {
  const count = loop.length

  const solveFoot = (theta: number, start: FootState): Solution | null => {
    const ex = Math.cos(theta)
    const ey = Math.sin(theta)
    // e⊥ = n′(θ): W is on the ray when e⊥·W = 0
    const px = -ey
    const py = ex
    let { piece, t, phi } = start
    for (let iter = 0; iter < MAX_NEWTON; iter++) {
      const g = localAt(loop[piece], t)
      const ps = pose(phi)
      const rq = rot(ps, g.q)
      const wx = ps.p1.x + rq.x
      const wy = ps.p1.y + rq.y
      const u = unrot(ps, ps.p1d)
      const qxn = cross(g.q, g.n)
      const f1 = px * wx + py * wy
      const f2 = dot(u, g.n) + ps.a1 * qxn
      // W_φ = P1′ + α′ J R q
      const wpx = ps.p1d.x - ps.a1 * rq.y
      const wpy = ps.p1d.y + ps.a1 * rq.x
      if (Math.abs(f1) < RESIDUAL_TOL && Math.abs(f2) < RESIDUAL_TOL) {
        const r = ex * wx + ey * wy
        if (!(r > 0)) return null
        const wt = rot(ps, g.qd)
        const useCurve = loop[piece].seg !== null && length(wt) > 1e-9
        const tx = useCurve ? wt.x : wpx
        const ty = useCurve ? wt.y : wpy
        const tl = Math.hypot(tx, ty)
        if (!(tl > 0)) return null
        return { seed: { piece, t, phi }, p: { x: wx, y: wy }, r, tangent: { x: tx / tl, y: ty / tl } }
      }
      const wt = rot(ps, g.qd)
      // u′ = R(−α) P1″ − α′ J u
      const rp = unrot(ps, ps.p1dd)
      const upx = rp.x + ps.a1 * u.y
      const upy = rp.y - ps.a1 * u.x
      const f1t = px * wt.x + py * wt.y
      const f1p = px * wpx + py * wpy
      const f2t = dot(u, g.nd) + ps.a1 * (cross(g.qd, g.n) + cross(g.q, g.nd))
      const f2p = upx * g.n.x + upy * g.n.y + ps.a2 * qxn
      const det = f1t * f2p - f1p * f2t
      if (!(Math.abs(det) > 1e-300)) return null
      const dt = (-f1 * f2p + f2 * f1p) / det
      const dp = (-f1t * f2 + f2t * f1) / det
      const damp = Math.min(1, 0.5 / Math.abs(dt), 0.25 / Math.abs(dp))
      if (!Number.isFinite(damp)) return null
      phi += dp * damp
      t += dt * damp
      // Cross into the neighbouring piece one boundary at a time
      if (t > 1) {
        piece = (piece + 1) % count
        t = 0
      } else if (t < 0) {
        piece = (piece - 1 + count) % count
        t = 1
      }
    }
    return null
  }

  const solveCam = (theta: number): Solution => ({
    seed: 'cam',
    p: { x: camReach * Math.cos(theta), y: camReach * Math.sin(theta) },
    r: camReach,
    tangent: { x: -Math.sin(theta), y: Math.cos(theta) },
  })

  return {
    solve: (theta, seed) => (seed === 'cam' ? solveCam(theta) : solveFoot(theta, seed)),
    derivative(sol, theta) {
      // W(θ) = R(θ) n(θ) with W′ ∥ T gives W′ = R T / (T · n′(θ))
      const den = -sol.tangent.x * Math.sin(theta) + sol.tangent.y * Math.cos(theta)
      const k = sol.r / (Math.abs(den) > 1e-9 ? den : Math.sign(den || 1) * 1e-9)
      return { x: k * sol.tangent.x, y: k * sol.tangent.y }
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Grid, contours and seeds (SPEC §11.10 steps 2–4, 7)

interface Column {
  piece: number
  t: number
  /** Local parameter where this column's cell ends (the next column, or the end of the piece) */
  tEnd: number
}

interface Crossing {
  x: number
  y: number
  piece: number
  t: number
  phi: number
}

interface Seeds {
  r: Float64Array
  seed: (Seed | null)[]
  exact: boolean
}

function findSeeds(loop: LoopPiece[], pose: PoseFn, camReach: number): Seeds {
  const columns: Column[] = []
  loop.forEach((piece, i) => {
    for (let j = 0; j < piece.columns; j++) {
      columns.push({ piece: i, t: j / piece.columns, tEnd: (j + 1) / piece.columns })
    }
  })
  const C = columns.length
  const K = PHI_ROWS
  const dPhi = TAU / K

  // b(σ) = (n, q × n) per column; a(φ) = (u, α′) per row
  const local = columns.map((c) => localAt(loop[c.piece], c.t))
  const rows = Array.from({ length: K }, (_, k) => pose(k * dPhi))
  const g = new Float64Array(K * C)
  let minStar = Infinity
  for (let k = 0; k < K; k++) {
    const ps = rows[k]
    const u = unrot(ps, ps.p1d)
    // P0 in the foot frame: o = R(−α)(P0 − P1)
    const o = unrot(ps, { x: -ps.p1.x, y: -ps.p1.y })
    for (let c = 0; c < C; c++) {
      const { q, n } = local[c]
      g[k * C + c] = u.x * n.x + u.y * n.y + ps.a1 * (q.x * n.y - q.y * n.x)
      minStar = Math.min(minStar, (q.x - o.x) * n.x + (q.y - o.y) * n.y)
    }
  }

  const M = RAYS
  const dTheta = TAU / M
  const cosT = new Float64Array(M)
  const sinT = new Float64Array(M)
  for (let m = 0; m < M; m++) {
    cosT[m] = Math.cos(-Math.PI + m * dTheta)
    sinT[m] = Math.sin(-Math.PI + m * dTheta)
  }
  const rayR = new Float64Array(M).fill(-Infinity)
  const raySeed: (Seed | null)[] = new Array<Seed | null>(M).fill(null)

  const rasterize = (a: Crossing, b: Crossing) => {
    const ta = Math.atan2(a.y, a.x)
    const span = wrapPi(Math.atan2(b.y, b.x) - ta)
    const lo = Math.min(ta, ta + span)
    const hi = Math.max(ta, ta + span)
    const dx = b.x - a.x
    const dy = b.y - a.y
    for (let m = Math.ceil((lo + Math.PI) / dTheta); m <= Math.floor((hi + Math.PI) / dTheta); m++) {
      const i = ((m % M) + M) % M
      const ex = cosT[i]
      const ey = sinT[i]
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-15) continue
      const s = -(a.x * ey - a.y * ex) / den
      if (s < -1e-9 || s > 1 + 1e-9) continue
      const r = (a.x + s * dx) * ex + (a.y + s * dy) * ey
      if (r <= rayR[i]) continue
      rayR[i] = r
      const near = s < 0.5 ? a : b
      raySeed[i] = {
        piece: a.piece === b.piece ? a.piece : near.piece,
        t: a.piece === b.piece ? a.t + s * (b.t - a.t) : near.t,
        phi: a.phi + s * wrapPi(b.phi - a.phi),
      }
    }
  }

  // Zero crossings on the edges of the periodic grid, computed once per edge
  const hCache: (Crossing | undefined)[] = new Array<Crossing | undefined>(K * C)
  const vCache: (Crossing | undefined)[] = new Array<Crossing | undefined>(K * C)
  const at = (k: number, c: number) => g[(k % K) * C + (c % C)]
  const hCross = (k: number, c: number): Crossing => {
    const key = (k % K) * C + (c % C)
    let x = hCache[key]
    if (!x) {
      const col = columns[c % C]
      const g0 = at(k, c)
      const t = col.t + (g0 / (g0 - at(k, c + 1))) * (col.tEnd - col.t)
      const phi = (k % K) * dPhi
      const w = place(rows[k % K], localAt(loop[col.piece], t).q)
      x = { x: w.x, y: w.y, piece: col.piece, t, phi }
      hCache[key] = x
    }
    return x
  }
  const vCross = (k: number, c: number): Crossing => {
    const key = (k % K) * C + (c % C)
    let x = vCache[key]
    if (!x) {
      const col = columns[c % C]
      const g0 = at(k, c)
      const phi = ((k % K) + g0 / (g0 - at(k + 1, c))) * dPhi
      const w = place(pose(phi), local[c % C].q)
      x = { x: w.x, y: w.y, piece: col.piece, t: col.t, phi }
      vCache[key] = x
    }
    return x
  }

  // Marching squares on the torus: rows are φ, columns are σ
  for (let k = 0; k < K; k++) {
    for (let c = 0; c < C; c++) {
      const v00 = at(k, c) >= 0
      const v01 = at(k, c + 1) >= 0
      const v10 = at(k + 1, c) >= 0
      const v11 = at(k + 1, c + 1) >= 0
      if (v00 === v01 && v00 === v10 && v00 === v11) continue
      const bottom = v00 !== v01 ? hCross(k, c) : null
      const top = v10 !== v11 ? hCross(k + 1, c) : null
      const left = v00 !== v10 ? vCross(k, c) : null
      const right = v01 !== v11 ? vCross(k, c + 1) : null
      if (bottom && right && top && left) {
        const centre = (at(k, c) + at(k, c + 1) + at(k + 1, c) + at(k + 1, c + 1)) / 4 >= 0
        if (centre === v00) {
          rasterize(bottom, right)
          rasterize(top, left)
        } else {
          rasterize(bottom, left)
          rasterize(top, right)
        }
        continue
      }
      const ends = [bottom, right, top, left].filter((x): x is Crossing => x !== null)
      if (ends.length === 2) rasterize(ends[0], ends[1])
    }
  }

  // The cam disc's sweep competes as a circle about P0
  for (let m = 0; m < M; m++) {
    if (camReach > rayR[m]) {
      rayR[m] = camReach
      raySeed[m] = 'cam'
    }
  }
  return { r: rayR, seed: raySeed, exact: minStar >= -1e-7 }
}

// ---------------------------------------------------------------------------------------------
// Trace and fit (SPEC §11.10 steps 5–6)

interface Run {
  /** Solutions along this branch, by increasing θ */
  states: { theta: number; sol: Solution }[]
  /** Straight jump from the previous run (only when the result is the conservative radial hull) */
  jump: boolean
}

function sameBranch(a: Seed, b: Seed, pieces: number): boolean {
  if (a === 'cam' || b === 'cam') return a === b
  const ds = Math.abs(a.piece + a.t - (b.piece + b.t))
  return Math.min(ds, pieces - ds) < 0.25 && Math.abs(wrapPi(a.phi - b.phi)) < 0.05
}

function trace(solver: Solver, seeds: Seeds, pieces: number): Run[] | null {
  const M = RAYS
  const dTheta = TAU / M
  const rayTheta = (m: number) => -Math.PI + m * dTheta

  /** Continue a solution to θ, in smaller steps if a direct jump fails */
  const follow = (from: { theta: number; sol: Solution }, theta: number): Solution | null => {
    const direct = solver.solve(theta, from.sol.seed)
    if (direct) return direct
    let cur = from.sol
    for (let i = 1; i <= 4; i++) {
      const next = solver.solve(from.theta + ((theta - from.theta) * i) / 4, cur.seed)
      if (!next) return null
      cur = next
    }
    return cur
  }

  const sweep = (m0: number, first: Solution): Run[] => {
    const theta0 = rayTheta(m0)
    const runs: Run[] = [{ states: [{ theta: theta0, sol: first }], jump: false }]
    const current = () => runs[runs.length - 1]

    /** Adds a solution to the current run unless it is not past the run's last θ */
    const extend = (theta: number, sol: Solution) => {
      const states = current().states
      if (theta > states[states.length - 1].theta) states.push({ theta, sol })
    }

    /** Branch B (known at θb) is above the current branch at θb: find where it takes over */
    const takeOver = (b: Solution, thetaB: number) => {
      const run = current()
      let hiTheta = thetaB
      let hi = b
      for (let back = 0; back < MAX_BACKTRACK && run.states.length > 1; back++) {
        const last = run.states[run.states.length - 1]
        const bHere = follow({ theta: hiTheta, sol: hi }, last.theta)
        if (bHere && bHere.r > last.sol.r) {
          // B was already outside at the previous ray: the change happened earlier
          run.states.pop()
          hiTheta = last.theta
          hi = bHere
          continue
        }
        break
      }
      const lo = run.states[run.states.length - 1]
      const aAt = (theta: number) => follow(lo, theta)
      const bAt = (theta: number) => follow({ theta: hiTheta, sol: hi }, theta)
      const bLo = bAt(lo.theta)
      if (bLo) {
        // Both branches exist across the gap: the boundary has a reflex corner where they cross
        const h = (theta: number) => {
          const a = aAt(theta)
          const bb = bAt(theta)
          if (!a) return -1
          if (!bb) return 1
          return a.r - bb.r
        }
        const x = brent(h, lo.theta, hiTheta, 1e-13)
        const a = aAt(x)
        const bx = bAt(x)
        if (a && bx) {
          extend(x, a)
          runs.push({ states: [{ theta: x, sol: bx }], jump: false })
          extend(hiTheta, hi)
          extend(thetaB, b)
          return
        }
      }
      // B appears inside the gap (only possible for feet that are not star-shaped): jump to it
      let a0 = lo.theta
      let b0 = hiTheta
      for (let i = 0; i < 40; i++) {
        const mid = (a0 + b0) / 2
        if (bAt(mid)) b0 = mid
        else a0 = mid
      }
      const a = aAt(b0)
      if (a) extend(b0, a)
      runs.push({ states: [{ theta: b0, sol: bAt(b0) ?? hi }], jump: true })
      extend(hiTheta, hi)
      extend(thetaB, b)
    }

    /** The current branch ended between its last ray and θ (non-star feet only): jump down to B */
    const branchEnds = (b: Solution, thetaB: number) => {
      const lo = current().states[current().states.length - 1]
      let a0 = lo.theta
      let b0 = thetaB
      for (let i = 0; i < 40; i++) {
        const mid = (a0 + b0) / 2
        if (follow(lo, mid)) a0 = mid
        else b0 = mid
      }
      const endA = follow(lo, a0)
      if (endA) extend(a0, endA)
      runs.push({ states: [{ theta: a0, sol: follow({ theta: thetaB, sol: b }, a0) ?? b }], jump: true })
      extend(thetaB, b)
    }

    for (let i = 1; i <= M; i++) {
      const m = (m0 + i) % M
      const theta = theta0 + i * dTheta
      const run = current()
      const last = run.states[run.states.length - 1]
      const next = follow(last, theta)
      const seed = seeds.seed[m]
      let alt: Solution | null = null
      if (seed && (!next || seeds.r[m] > next.r - SEED_SLACK) && !(next && sameBranch(seed, next.seed, pieces))) {
        alt = solver.solve(theta, seed)
      }
      if (alt && (!next || alt.r > next.r + 1e-9)) {
        if (next) takeOver(alt, theta)
        else branchEnds(alt, theta)
      } else if (next) {
        run.states.push({ theta, sol: next })
      }
      // Neither the current branch nor this ray's seed solved: skip the ray and keep going
    }
    return runs
  }

  // Start from the ray that reaches furthest: its seed is the least likely to be ambiguous
  const order = Array.from({ length: M }, (_, m) => m).sort((a, b) => seeds.r[b] - seeds.r[a])
  for (const m0 of order.slice(0, 16)) {
    const seed = seeds.seed[m0]
    if (!seed) continue
    const first = solver.solve(rayTheta(m0), seed)
    if (!first) continue
    let runs = sweep(m0, first)
    // If the lap came back further out than it started, the start was not outermost: go round again
    const end = runs[runs.length - 1].states.at(-1)
    if (end && end.sol.r > first.r + 1e-7) runs = sweep(m0, end.sol)
    return runs
  }
  return null
}

function fitRuns(solver: Solver, runs: Run[]): CubicBezier[] {
  const out: CubicBezier[] = []
  let prevEnd: Vec2 | null = null
  for (const run of runs) {
    const states = run.states
    const start = states[0]
    const end = states[states.length - 1]
    if (prevEnd && (run.jump || Math.hypot(prevEnd.x - start.sol.p.x, prevEnd.y - start.sol.p.y) > 1e-9)) {
      out.push(line(prevEnd, start.sol.p))
    }
    if (end.theta - start.theta > 1e-12) {
      const nearest = (theta: number) => {
        let lo = 0
        let hi = states.length - 1
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1
          if (states[mid].theta <= theta) lo = mid
          else hi = mid
        }
        return theta - states[lo].theta <= states[hi].theta - theta ? [states[lo], states[hi]] : [states[hi], states[lo]]
      }
      const f = (theta: number): Sample2D => {
        for (const s of nearest(theta)) {
          const sol = solver.solve(theta, s.sol.seed)
          if (sol) return { p: sol.p, d: solver.derivative(sol, theta) }
        }
        // Not expected: fall back to the nearest known point on the ray
        const s = nearest(theta)[0].sol
        const p = { x: s.r * Math.cos(theta), y: s.r * Math.sin(theta) }
        return { p, d: { x: -p.y, y: p.x } }
      }
      for (const piece of fitCurve2D(f, start.theta, end.theta, FIT_TOL)) out.push(piece2DToBezier(piece))
    }
    prevEnd = end.sol.p
  }
  const first = out[0]
  if (prevEnd && first && Math.hypot(prevEnd.x - first.p0.x, prevEnd.y - first.p0.y) > 1e-9) out.push(line(prevEnd, first.p0))
  return out
}

const line = (a: Vec2, b: Vec2): CubicBezier => ({
  p0: a,
  p1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
  p2: { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 },
  p3: b,
})

/**
 * Outer boundary of everything the foot (outline `ccw`) and its cam (radius `camRadius`) sweep over a
 * revolution (SPEC §4.6, §11.10). Returns null if the outline is degenerate.
 */
export function computeSweptArea(ccw: Segment[], drive: Drive, constraint: TiltConstraint, camRadius: number): SweptArea | null {
  const loop = buildLoop(ccw)
  if (loop.length < 2) return null
  const pose = poseFn(drive, constraint)
  const camReach = drive.L + camRadius
  const solver = createSolver(loop, pose, camReach)
  const seeds = findSeeds(loop, pose, camReach)
  const runs = trace(solver, seeds, loop.length)
  if (!runs) return null
  return { boundary: fitRuns(solver, runs), exact: seeds.exact }
}
