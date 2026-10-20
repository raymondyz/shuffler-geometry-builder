import { boreRadius, slotRadius } from '../design/hardware'
import type { Hardware } from '../design/schema'
import { TAU, wrapTau } from '../math/angle'
import { length, type Vec2 } from '../math/vec2'
import { createCenterlineSlot } from '../mechanism/constraints/centerlineSlot'
import { eccentricDrive } from '../mechanism/drive'
import { activeGoals, type Brief, type GoalMetric } from './brief'
import { Expr, LpBuilder, type LpSolver } from './lp'
import { createProfile, type Profile, type ProfileWeights } from './profile'

/** Mechanism parameters chosen by the outer search (SPEC §10.7). */
export interface MechanismChoice {
  feet: number
  L: number
  pin: Vec2
  /** Centre of foot 0's stance window; 3π/2 puts stance directly under the shaft */
  stanceCentre: number
}

/** The LP's own measure of the result (sampled); the app shows the full analysis instead. */
export interface Estimates {
  bob: number
  stride: number
  ripple: number
  kink: number
  slip: number
  lift: number
  rideMin: number
  rideMax: number
}

export type ProfileOutcome =
  | { ok: true; mech: MechanismChoice; profile: Profile; x: Float64Array; score: number; feasible: boolean; estimates: Estimates }
  | { ok: false; mech: MechanismChoice; violation: number }

export interface InnerContext {
  brief: Brief
  hardware: Hardware
  solver: LpSolver
}

const STANCE_SAMPLES = 48
const BOX_POSES = 48
const WALL_DIRECTIONS = 24
const PROFILE_COEFFICIENTS = 16
const RHO_MAX = 5000
/** Cost per unit of a limit or space violation, relative to the limit's size */
const PENALTY = 100
/** Augmented-Chebyshev tie-break on the sum of weighted shortfalls */
const SUM_WEIGHT = 0.01
/**
 * Tie-breaks for parts of the profile no goal cares about: prefer smaller radii (a compact foot that
 * curls up where it doesn't need to be flat) and gently varying curvature (no wiggles). Both are far
 * too small to trade against any goal.
 */
const COMPACT_WEIGHT = 1e-6
const SMOOTHNESS_WEIGHT = 1e-6
/** Extra clearance over the minimum wall, so validation never sees a wall exactly at the limit */
const WALL_MARGIN = 0.05
/** Radius of the arcs that continue the contact curve into the sides (SPEC §10.8); the box keeps this margin */
export const EXTENSION_RADIUS = 3

interface Pose {
  p1: Vec2
  p1d: Vec2
  p1dd: Vec2
  alpha: number
  a1: number
  a2: number
  w: ProfileWeights
}

/** Fixed discs the foot must enclose with a wall: bore and both slot ends (foot frame) */
export function footDiscs(mech: MechanismChoice, hardware: Hardware): { c: Vec2; r: number }[] {
  const pd = length(mech.pin)
  const bore = boreRadius({ drive: { kind: 'eccentric', L: mech.L }, hardware }) + hardware.minWall + WALL_MARGIN
  const slot = slotRadius(hardware) + hardware.minWall + WALL_MARGIN
  return [
    { c: { x: 0, y: 0 }, r: bore },
    { c: { x: 0, y: pd - mech.L }, r: slot },
    { c: { x: 0, y: pd + mech.L }, r: slot },
  ]
}

/** Tilt range over a revolution, from the constraint's exact extrema */
function tiltRange(constraint: ReturnType<typeof createCenterlineSlot>): [number, number] {
  const ext = constraint.tiltExtrema()
  const alphas = ext.length >= 2 ? ext.map((p) => constraint.tilt(p).alpha) : Array.from({ length: 360 }, (_, i) => constraint.tilt((TAU * i) / 360).alpha)
  return [Math.min(...alphas), Math.max(...alphas)]
}

/**
 * Best convex contact profile for one mechanism (SPEC §10.5): one linear program. Hard rules (lowest
 * foot, walls, curvature) are strict; limits, ride height and space are elastic with a large penalty,
 * so an impossible request still returns its least-bad answer and how far it misses.
 */
export function solveProfile(mech: MechanismChoice, ctx: InnerContext, meanSpeedGuess?: number): ProfileOutcome {
  const { brief, hardware, solver } = ctx
  const N = mech.feet
  const pd = length(mech.pin)
  if (!(pd > mech.L) || !(mech.L > 0)) return { ok: false, mech, violation: mech.L - pd + 1 }

  // Mechanism-level checks: the slot must clear the bore, and the fixed discs must fit the box
  const discs = footDiscs(mech, hardware)
  const drive = eccentricDrive(mech.L)
  const constraint = createCenterlineSlot({ kind: 'centerlineSlot', pin: mech.pin }, drive)
  let violation = Math.max(0, hardware.minWall - (pd - mech.L - slotRadius(hardware) - boreRadius({ drive: { kind: 'eccentric', L: mech.L }, hardware })))
  const { above, front, behind } = brief.space
  for (let j = 0; j < BOX_POSES; j++) {
    const phi = (TAU * j) / BOX_POSES
    const p1 = drive.p1(phi)
    const a = constraint.tilt(phi).alpha
    for (const d of discs) {
      const x = p1.x + Math.cos(a) * d.c.x - Math.sin(a) * d.c.y
      const y = p1.y + Math.sin(a) * d.c.x + Math.cos(a) * d.c.y
      // How far the disc sticks out of the front, back and top of the box
      violation = Math.max(violation, -front - (x - d.r), x + d.r - behind, y + d.r - above)
    }
  }
  if (violation > 1e-9) return { ok: false, mech, violation }

  const [alphaLo, alphaHi] = tiltRange(constraint)
  const profile = createProfile(-Math.PI / 2 - alphaHi - 0.002, -Math.PI / 2 - alphaLo + 0.002, PROFILE_COEFFICIENTS)
  const K = profile.count

  const poseCache = new Map<number, Pose>()
  const pose = (phi: number): Pose => {
    let p = poseCache.get(phi)
    if (!p) {
      const t = constraint.tilt(phi)
      p = { p1: drive.p1(phi), p1d: drive.p1d(phi), p1dd: drive.p1dd(phi), alpha: t.alpha, a1: t.d1, a2: t.d2, w: profile.weights(-Math.PI / 2 - t.alpha) }
      poseCache.set(phi, p)
    }
    return p
  }
  // Linear forms of §10.3 (profile variables occupy LP columns 0 … size−1)
  const y0 = (phi: number) => { const p = pose(phi); return Expr.dense(p.p1.y, p.w.h, 0, -1) }
  const y0d = (phi: number) => { const p = pose(phi); return Expr.dense(p.p1d.y, p.w.hd, 0, p.a1) }
  /** Forward speed toward −x: −v = P1x′ + α′h */
  const speed = (phi: number) => { const p = pose(phi); return Expr.dense(p.p1d.x, p.w.h, 0, p.a1) }

  const build = (meanGuess: number) => {
    const lp = new LpBuilder()
    for (let i = 0; i < profile.size; i++) {
      if (i === 0) lp.addVar(brief.symmetric ? 0 : -Infinity, brief.symmetric ? 0 : Infinity)
      else if (i === 1) lp.addVar()
      else lp.addVar(brief.minContactRadius, RHO_MAX, COMPACT_WEIGHT)
    }
    const tHi = lp.addVar()
    const tLo = lp.addVar()
    const sHi = lp.addVar()
    const sLo = lp.addVar()
    const z = lp.addVar(0, Infinity, 1)
    const slacks: number[] = []
    const elastic = (ref: number) => {
      const s = lp.addVar(0, Infinity, PENALTY / Math.max(1e-6, ref))
      slacks.push(s)
      return s
    }

    const delta = TAU / N
    const start = mech.stanceCentre - delta / 2
    const phis = Array.from({ length: STANCE_SAMPLES + 1 }, (_, i) => start + (delta * i) / STANCE_SAMPLES)

    // Stance: bob and speed bounds, and foot 0 is the lowest with a clean handoff
    for (const phi of phis) {
      const y = y0(phi)
      const s = speed(phi)
      lp.atMost(y.plus(Expr.of(tHi), -1), 0)
      lp.atLeast(y.plus(Expr.of(tLo), -1), 0)
      lp.atMost(s.plus(Expr.of(sHi), -1), 0)
      lp.atLeast(s.plus(Expr.of(sLo), -1), 0)
      const fromHandoff = Math.min(phi - start, start + delta - phi)
      for (let k = 1; k < N; k++) lp.atLeast(y0(phi + k * delta).plus(y, -1), brief.handoffLift * fromHandoff)
    }

    // Ride height: shaft above ground during stance
    if (brief.rideHeight) {
      const { min, max } = brief.rideHeight
      const s = elastic(Math.max(1, max))
      for (const phi of phis) {
        const height = y0(phi).times(-1)
        lp.atLeast(height.plus(Expr.of(s)), min)
        lp.atMost(height.plus(Expr.of(s), -1), max)
      }
    }

    // Space: the contact curve's ends at every pose stay inside the box (its x and y extremes are
    // at the ends, since its normals all point downward)
    {
      const s = elastic(Math.max(1, above))
      const ends = [profile.lo, profile.hi].map((psi) => {
        const w = profile.weights(psi)
        const c = Math.cos(psi)
        const sn = Math.sin(psi)
        // q = h n + h′ n′
        const qx = Expr.dense(0, w.h, 0, c).plus(Expr.dense(0, w.hd, 0, -sn))
        const qy = Expr.dense(0, w.h, 0, sn).plus(Expr.dense(0, w.hd, 0, c))
        return { qx, qy }
      })
      for (let j = 0; j < BOX_POSES; j++) {
        const p = pose(start + (TAU * j) / BOX_POSES)
        const ca = Math.cos(p.alpha)
        const sa = Math.sin(p.alpha)
        for (const { qx, qy } of ends) {
          const x = qx.times(ca).plus(qy, -sa)
          x.k += p.p1.x
          const y = qx.times(sa).plus(qy, ca)
          y.k += p.p1.y
          lp.atLeast(x.plus(Expr.of(s)), -front + EXTENSION_RADIUS)
          lp.atMost(x.plus(Expr.of(s), -1), behind - EXTENSION_RADIUS)
          lp.atMost(y.plus(Expr.of(s), -1), above - EXTENSION_RADIUS)
        }
      }
    }

    // Walls: the contact curve stays outside the bore and slot discs (which include the wall)
    for (let m = 0; m <= WALL_DIRECTIONS; m++) {
      const psi = profile.lo + ((profile.hi - profile.lo) * m) / WALL_DIRECTIONS
      const n = { x: Math.cos(psi), y: Math.sin(psi) }
      const support = Math.max(...discs.map((d) => d.c.x * n.x + d.c.y * n.y + d.r))
      lp.atLeast(Expr.dense(0, profile.weights(psi).h), support)
    }

    // Symmetry and smoothness
    if (brief.symmetric) {
      for (let j = 0; j < K / 2; j++) lp.equal(Expr.of(2 + j).plus(Expr.of(2 + K - 1 - j), -1), 0)
    }
    for (let j = 1; j + 1 < K; j++) {
      // |c_{j+1} − 2c_j + c_{j−1}|: straight ramps in radius are free, bumps are not
      const d = lp.addVar(0, Infinity, SMOOTHNESS_WEIGHT)
      const bend = Expr.of(2 + j + 1).plus(Expr.of(2 + j), -2).plus(Expr.of(2 + j - 1))
      lp.atLeast(Expr.of(d).plus(bend, -1), 0)
      lp.atLeast(Expr.of(d).plus(bend), 0)
    }

    // Metrics as linear expressions
    const simpson = phis.map((_, i) => ((i === 0 || i === STANCE_SAMPLES ? 1 : i % 2 ? 4 : 2) * delta) / STANCE_SAMPLES / 3)
    let travel = new Expr()
    phis.forEach((phi, i) => { travel = travel.plus(speed(phi), simpson[i]) })
    const mean = travel.times(1 / delta)
    const slip = lp.addVar(0)
    const speedJump = speed(start + delta).plus(speed(start), -1)
    lp.atLeast(Expr.of(slip).plus(speedJump, -1), 0)
    lp.atLeast(Expr.of(slip).plus(speedJump), 0)
    const swingPhi = mech.stanceCentre + Math.PI
    let stanceFoot = 1
    for (let k = 1; k < N; k++) if (wrapTau(swingPhi + k * delta - start) < delta) stanceFoot = k
    const metrics: Record<Exclude<GoalMetric, 'ripple'>, Expr> = {
      bob: Expr.of(tHi).plus(Expr.of(tLo), -1),
      stride: travel.times(N),
      kink: y0d(start + delta).plus(y0d(start), -1),
      slip: Expr.of(slip),
      lift: y0(swingPhi).plus(y0(swingPhi + stanceFoot * delta), -1),
    }
    const spread = Expr.of(sHi).plus(Expr.of(sLo), -1)

    // Goals (SPEC §10.6): limits are elastic; goals feed the weighted Chebyshev score z
    for (const g of activeGoals(brief)) {
      const set = brief.goals[g.metric]
      const lower = g.better === 'lower'
      if (set.mode === 'limit') {
        if (g.metric === 'ripple') {
          const s = elastic(Math.max(1e-3, set.limit * meanGuess))
          lp.atMost(spread.plus(mean, -set.limit).plus(Expr.of(s), -1), 0)
        } else {
          const s = elastic(Math.max(1, Math.abs(set.limit)))
          if (lower) lp.atMost(metrics[g.metric].plus(Expr.of(s), -1), set.limit)
          else lp.atLeast(metrics[g.metric].plus(Expr.of(s)), set.limit)
        }
        continue
      }
      const range = Math.max(1e-6, Math.abs(set.acceptable - set.ideal))
      const u = lp.addVar(0, Infinity, SUM_WEIGHT * set.importance)
      lp.atLeast(Expr.of(z).plus(Expr.of(u), -set.importance), 0)
      if (g.metric === 'ripple') {
        // (max − min) ≤ (ideal + range·u)·mean, with the u term at the estimated mean speed
        lp.atMost(spread.plus(mean, -set.ideal).plus(Expr.of(u), -range * meanGuess), 0)
      } else if (lower) {
        lp.atMost(metrics[g.metric].plus(Expr.of(u), -range), set.ideal)
      } else {
        lp.atLeast(metrics[g.metric].plus(Expr.of(u), range), set.ideal)
      }
    }
    return { lp, slacks, tHi, tLo, sHi, sLo, metrics, mean, spread }
  }

  const solve = (meanGuess: number) => {
    const model = build(meanGuess)
    if (model.lp.impossible > 0) return null
    const result = solver(model.lp.build())
    if (result.status !== 'optimal') return null
    return { model, result }
  }

  const rippleGoal = brief.goals.ripple.mode !== 'off'
  let guess = meanSpeedGuess ?? mech.L * 2
  let solved = solve(guess)
  if (solved && rippleGoal) {
    const mean = solved.model.mean.value(solved.result.x)
    if (mean > 0 && Math.abs(mean - guess) > 0.03 * mean) {
      guess = mean
      solved = solve(guess) ?? solved
    }
  }
  if (!solved) return { ok: false, mech, violation: 1 }

  const { model, result } = solved
  const x = result.x
  const mean = model.mean.value(x)
  const estimates: Estimates = {
    bob: model.metrics.bob.value(x),
    stride: model.metrics.stride.value(x),
    ripple: mean > 0 ? model.spread.value(x) / mean : Infinity,
    kink: model.metrics.kink.value(x),
    slip: model.metrics.slip.value(x),
    lift: model.metrics.lift.value(x),
    rideMin: -x[model.tHi],
    rideMax: -x[model.tLo],
  }
  const feasible = model.slacks.every((s) => x[s] < 1e-6)
  return { ok: true, mech, profile, x: x.slice(0, profile.size), score: result.objective, feasible, estimates }
}
