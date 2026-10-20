import { analyzeDesign } from '../analysis/analyze'
import { boreRadius, slotRadius } from '../design/hardware'
import type { Design } from '../design/schema'
import { activeGoals, GOALS, type Brief, type GoalMetric } from './brief'
import { closeOutline } from './closure'
import { solveProfile, type MechanismChoice, type ProfileOutcome } from './inner'
import type { LpSolver } from './lp'

/** A verified design: the numbers come from the full analysis, not the optimiser (SPEC §10.9). */
export interface Candidate {
  design: Design
  values: Record<GoalMetric, number>
  /** Worst goal shortfall: 0 = every goal ideal, 1 = every goal just acceptable */
  shortfall: number
  /** What it fails: goal or limit labels, "Space" or "Ride height" */
  misses: string[]
  score: number
}

export interface GenerateResult {
  candidates: Candidate[]
  /** Plain-language note when nothing meets everything */
  note: string | null
}

export interface GenerateCallbacks {
  onProgress?(done: number, total: number): void
  onCandidates?(candidates: Candidate[]): void
}

const MAX_CANDIDATES = 5
const STARTS_PER_FEET = 2
const NM_BUDGET = 24
const GRID_POINTS = [1, 7, 5, 4, 3]
const STANCE_SWING = (25 * Math.PI) / 180
/** Mechanism dimensions are rounded before the final solve, so designs come out in tidy numbers */
const ROUND_TO = 0.1

interface Dim {
  min: number
  max: number
}

interface Evaluated {
  u: number[]
  outcome: ProfileOutcome
  score: number
}

const round = (v: number) => Math.round(v / ROUND_TO) * ROUND_TO

/** The search space: eccentricity, pin height, pin offset and stance centre (fixed when min = max) */
function searchDims(base: Design, brief: Brief): { L: Dim; pinY: Dim; pinX: Dim; centre: Dim } | null {
  const hw = base.hardware
  const L = { min: Math.min(brief.eccentricity.min, brief.eccentricity.max), max: Math.max(brief.eccentricity.min, brief.eccentricity.max) }
  let pinY: Dim
  if (brief.pinHeight) {
    pinY = { min: Math.min(brief.pinHeight.min, brief.pinHeight.max), max: Math.max(brief.pinHeight.min, brief.pinHeight.max) }
  } else {
    // Free: from just clearing the bore up to what the room above allows
    const slot = slotRadius(hw) + hw.minWall
    const low = L.min + slotRadius(hw) + boreRadius({ drive: { kind: 'eccentric', L: L.min }, hardware: hw }) + hw.minWall
    pinY = { min: low, max: brief.space.above - slot - L.min }
    if (pinY.max < pinY.min) return null
  }
  const pinX = brief.symmetric ? { min: 0, max: 0 } : { min: Math.min(brief.pinOffset.min, brief.pinOffset.max), max: Math.max(brief.pinOffset.min, brief.pinOffset.max) }
  const centre = brief.symmetric ? { min: 1.5 * Math.PI, max: 1.5 * Math.PI } : { min: 1.5 * Math.PI - STANCE_SWING, max: 1.5 * Math.PI + STANCE_SWING }
  return { L, pinY, pinX, centre }
}

/** Nelder–Mead on the unit cube (points are clamped into it). */
function nelderMead(f: (u: number[]) => number, start: number[], budget: number): void {
  const d = start.length
  if (d === 0) return
  const clamp = (u: number[]) => u.map((v) => Math.min(1, Math.max(0, v)))
  let simplex = [start, ...start.map((_, i) => clamp(start.map((v, j) => (j === i ? v + (v > 0.5 ? -0.15 : 0.15) : v))))].map((u) => ({ u, f: f(u) }))
  let evals = d
  const mix = (a: number[], b: number[], t: number) => clamp(a.map((v, i) => v + t * (b[i] - v)))
  while (evals < budget) {
    simplex.sort((a, b) => a.f - b.f)
    const worst = simplex[d]
    const centroid = start.map((_, i) => simplex.slice(0, d).reduce((s, p) => s + p.u[i], 0) / d)
    const reflected = mix(centroid, worst.u, -1)
    const fr = f(reflected)
    evals++
    if (fr < simplex[0].f) {
      const expanded = mix(centroid, worst.u, -2)
      const fe = f(expanded)
      evals++
      simplex[d] = fe < fr ? { u: expanded, f: fe } : { u: reflected, f: fr }
    } else if (fr < simplex[d - 1].f) {
      simplex[d] = { u: reflected, f: fr }
    } else {
      const contracted = mix(centroid, worst.u, 0.5)
      const fc = f(contracted)
      evals++
      if (fc < worst.f) simplex[d] = { u: contracted, f: fc }
      else {
        simplex = simplex.map((p, i) => (i === 0 ? p : { u: mix(simplex[0].u, p.u, 0.5), f: f(mix(simplex[0].u, p.u, 0.5)) }))
        evals += d
      }
    }
  }
}

/** Measured values and how they compare with the brief */
function judge(design: Design, brief: Brief): Omit<Candidate, 'design' | 'score'> | null {
  const analysis = analyzeDesign(design)
  const k = analysis.kinematics
  if (!k || analysis.issues.some((i) => i.level === 'error')) return null
  const m = k.metrics
  const values: Record<GoalMetric, number> = {
    bob: m.bob,
    stride: m.strideRev,
    ripple: m.speedRipple,
    kink: m.handoffKink,
    slip: m.handoffSlip,
    lift: m.footLift,
  }
  const misses: string[] = []
  let shortfall = 0
  for (const g of activeGoals(brief)) {
    const set = brief.goals[g.metric]
    const v = values[g.metric]
    const lower = g.better === 'lower'
    if (set.mode === 'limit') {
      const slack = 0.01 * Math.abs(set.limit) + 1e-3
      if (lower ? v > set.limit + slack : v < set.limit - slack) misses.push(g.label)
      continue
    }
    const range = Math.max(1e-9, Math.abs(set.acceptable - set.ideal))
    const s = Math.max(0, (lower ? v - set.ideal : set.ideal - v) / range)
    shortfall = Math.max(shortfall, s)
    if (s > 1.02) misses.push(g.label)
  }
  const swept = analysis.swept()
  if (swept) {
    const pts = swept.boundary.flatMap((b) => [b.p0, b.p1, b.p2, b.p3])
    const tol = 0.05
    const top = Math.max(...pts.map((p) => p.y))
    const left = Math.min(...pts.map((p) => p.x))
    const right = Math.max(...pts.map((p) => p.x))
    if (top > brief.space.above + tol || left < -brief.space.front - tol || right > brief.space.behind + tol) misses.push('Space')
  }
  if (brief.rideHeight) {
    const lowest = -k.envelope.maxY
    const highest = -k.envelope.minY
    if (lowest < brief.rideHeight.min - 0.05 || highest > brief.rideHeight.max + 0.05) misses.push('Ride height')
  }
  return { values, shortfall, misses }
}

/**
 * Searches mechanisms (feet, eccentricity, pin, stance centre), solving the best contact profile for
 * each with one LP, then verifies the most promising, distinct designs with the full analysis.
 */
export function generateDesigns(base: Design, brief: Brief, solver: LpSolver, callbacks: GenerateCallbacks = {}): GenerateResult {
  const dims = searchDims(base, brief)
  const feet = [...new Set(brief.feet)].sort((a, b) => a - b)
  if (!dims || feet.length === 0) {
    return { candidates: [], note: !dims ? 'The slot and bore don’t fit in the room above the shaft. Allow more room above or a smaller eccentricity.' : 'Pick at least one number of feet.' }
  }
  if (activeGoals(brief).length === 0) return { candidates: [], note: 'Set at least one goal or limit.' }

  const order = ['L', 'pinY', 'pinX', 'centre'] as const
  const free = order.filter((key) => dims[key].max - dims[key].min > 1e-9)
  const toMech = (n: number, u: number[]): MechanismChoice => {
    const value = (key: (typeof order)[number]) => {
      const i = free.indexOf(key as (typeof free)[number])
      const d = dims[key]
      return i < 0 ? d.min : d.min + u[i] * (d.max - d.min)
    }
    return { feet: n, L: value('L'), pin: { x: value('pinX'), y: value('pinY') }, stanceCentre: value('centre') }
  }
  const ctx = { brief, hardware: base.hardware, solver }

  const perDim = GRID_POINTS[Math.min(free.length, GRID_POINTS.length - 1)]
  const grid: number[][] = [[]]
  for (let i = 0; i < free.length; i++) {
    const next: number[][] = []
    for (const g of grid) for (let j = 0; j < perDim; j++) next.push([...g, perDim === 1 ? 0.5 : j / (perDim - 1)])
    grid.splice(0, grid.length, ...next)
  }
  const total = feet.length * (grid.length + (free.length > 0 ? STARTS_PER_FEET * NM_BUDGET : 0))
  let done = 0
  const pool: Evaluated[] = []

  const evaluate = (n: number, u: number[]): number => {
    const outcome = solveProfile(toMech(n, u), ctx)
    const score = outcome.ok ? outcome.score : 1e4 + 100 * outcome.violation
    pool.push({ u, outcome, score })
    done++
    callbacks.onProgress?.(Math.min(done, total), total)
    return score
  }

  for (const n of feet) {
    const results = grid.map((u) => ({ u, score: evaluate(n, u) })).sort((a, b) => a.score - b.score)
    const starts: number[][] = []
    for (const r of results) {
      if (starts.length >= STARTS_PER_FEET || r.score >= 1e4) break
      if (starts.every((s) => Math.hypot(...s.map((v, i) => v - r.u[i])) > 0.3)) starts.push(r.u)
    }
    for (const s of starts) {
      const before = done
      nelderMead((u) => evaluate(n, u), s, NM_BUDGET)
      done = Math.max(done, before + NM_BUDGET)
      callbacks.onProgress?.(Math.min(done, total), total)
    }
    callbacks.onCandidates?.(pick(pool, free.length, base, brief, ctx).candidates)
  }
  callbacks.onProgress?.(total, total)
  return pick(pool, free.length, base, brief, ctx)
}

/** Picks the best distinct mechanisms, rounds them, re-solves and verifies them. */
function pick(pool: Evaluated[], dimCount: number, base: Design, brief: Brief, ctx: Parameters<typeof solveProfile>[1]): GenerateResult {
  const solved = pool.filter((e) => e.outcome.ok).sort((a, b) => a.score - b.score)
  const chosen: Evaluated[] = []
  const distinct = (a: Evaluated, b: Evaluated) =>
    a.outcome.mech.feet !== b.outcome.mech.feet || (dimCount > 0 && Math.hypot(...a.u.map((v, i) => v - b.u[i])) > 0.2)
  // The best of each feet count first, then the next best that differ
  for (const n of [...new Set(solved.map((e) => e.outcome.mech.feet))]) {
    const best = solved.find((e) => e.outcome.mech.feet === n)
    if (best) chosen.push(best)
  }
  chosen.sort((a, b) => a.score - b.score)
  for (const e of solved) {
    if (chosen.length >= MAX_CANDIDATES + 2) break
    if (chosen.every((c) => distinct(c, e))) chosen.push(e)
  }

  const candidates: Candidate[] = []
  for (const e of chosen) {
    const m = e.outcome.mech
    const mech: MechanismChoice = { ...m, L: round(m.L), pin: { x: round(m.pin.x), y: round(m.pin.y) } }
    const outcome = solveProfile(mech, ctx)
    if (!outcome.ok) continue
    const foot = closeOutline(outcome.profile, outcome.x, mech, base.hardware, brief.symmetric)
    const design: Design = {
      ...base,
      feet: { count: mech.feet },
      drive: { kind: 'eccentric', L: mech.L },
      constraint: { kind: 'centerlineSlot', pin: mech.pin },
      foot,
    }
    const verdict = judge(design, brief)
    if (verdict) candidates.push({ design, score: outcome.score, ...verdict })
  }
  candidates.sort((a, b) => a.misses.length - b.misses.length || a.shortfall - b.shortfall || a.score - b.score)
  // Show the best design for each number of feet, then fill up with the next best
  const shown: Candidate[] = []
  for (const c of candidates) if (!shown.some((s) => s.design.feet.count === c.design.feet.count)) shown.push(c)
  for (const c of candidates) if (shown.length < MAX_CANDIDATES && !shown.includes(c)) shown.push(c)
  shown.splice(MAX_CANDIDATES)
  shown.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b))
  let note: string | null = null
  if (shown.length === 0) note = 'No design could be built from this brief. Try more room, a wider eccentricity range or a free pin height.'
  else if (shown.every((c) => c.misses.length > 0)) note = 'Nothing meets every limit; these come closest. Relax a limit or allow more space.'
  return { candidates: shown, note }
}

export const goalLabels: Record<GoalMetric, string> = Object.fromEntries(GOALS.map((g) => [g.metric, g.label])) as Record<GoalMetric, string>
