import highsLoader from 'highs'
import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeDesign } from '../analysis/analyze'
import { createDefaultDesign } from '../design/defaults'
import type { Design } from '../design/schema'
import { fd } from '../test/helpers'
import { createBrief, presetGoals, type Brief } from './brief'
import { closeOutline } from './closure'
import { createHighsSolver } from './highsSolver'
import { solveProfile, type MechanismChoice } from './inner'
import type { LpSolver } from './lp'
import { createProfile, evaluateProfile } from './profile'
import { generateDesigns } from './search'

let solver: LpSolver
beforeAll(async () => {
  solver = createHighsSolver(await highsLoader())
})

const base = createDefaultDesign()

/** A brief around the default design: symmetric, 3 feet, L 6, pin 40, ride 50–60 mm, roomy box */
function testBrief(patch: Partial<Brief> = {}): Brief {
  const brief = createBrief(base, analyzeDesign(base))
  return {
    ...brief,
    feet: [3],
    eccentricity: { min: 6, max: 6 },
    pinHeight: { min: 40, max: 40 },
    rideHeight: { min: 50, max: 60 },
    space: { above: 90, front: 90, behind: 90 },
    goals: {
      ...presetGoals('balanced', 67),
      stride: { mode: 'limit', limit: 60, ideal: 80, acceptable: 60, importance: 2 },
      ripple: { mode: 'off', limit: 0.5, ideal: 0.15, acceptable: 0.5, importance: 2 },
    },
    ...patch,
  }
}

const mech: MechanismChoice = { feet: 3, L: 6, pin: { x: 0, y: 40 }, stanceCentre: 1.5 * Math.PI }

describe('curvature profile (SPEC §10.4)', () => {
  const profile = createProfile(-1.9, -1.2, 16)
  const x = new Float64Array(profile.size)
  x[0] = 3
  x[1] = -40
  for (let j = 0; j < profile.count; j++) x[2 + j] = 20 + 15 * Math.sin(j)

  it('h + h″ = ρ, and h′ is the derivative of h', () => {
    for (const psi of [-1.85, -1.6, -1.41, -1.25]) {
      const h = (p: number) => evaluateProfile(profile, x, p).h
      const v = evaluateProfile(profile, x, psi)
      expect(fd(h, psi, 1e-5)).toBeCloseTo(v.hd, 6)
      const h2 = (h(psi + 1e-4) - 2 * h(psi) + h(psi - 1e-4)) / 1e-8
      expect(v.h + h2).toBeCloseTo(v.rho, 3)
    }
  })

  it('the contact point moves along n′ at speed ρ', () => {
    for (const psi of [-1.8, -1.5, -1.3]) {
      const q = (p: number) => evaluateProfile(profile, x, p).q
      const v = evaluateProfile(profile, x, psi)
      expect(fd((p) => q(p).x, psi, 1e-5)).toBeCloseTo(-Math.sin(psi) * v.rho, 5)
      expect(fd((p) => q(p).y, psi, 1e-5)).toBeCloseTo(Math.cos(psi) * v.rho, 5)
    }
  })
})

describe('contact profile LP (SPEC §10.5)', () => {
  it('flattens bob on the default mechanism, and the full analysis agrees', () => {
    const brief = testBrief()
    const outcome = solveProfile(mech, { brief, hardware: base.hardware, solver })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.feasible).toBe(true)
    expect(outcome.estimates.bob).toBeLessThan(0.1)
    expect(outcome.estimates.stride).toBeGreaterThan(60 - 1e-6)

    const foot = closeOutline(outcome.profile, outcome.x, mech, base.hardware, true)
    expect(foot.mirror).toBe(true)
    const design: Design = { ...base, foot }
    const analysis = analyzeDesign(design)
    expect(analysis.issues.filter((i) => i.level === 'error')).toEqual([])
    const m = analysis.kinematics!.metrics
    expect(Math.abs(m.bob - outcome.estimates.bob)).toBeLessThan(0.05)
    expect(m.strideRev).toBeCloseTo(outcome.estimates.stride, 1)
    expect(m.speedRipple).toBeCloseTo(outcome.estimates.ripple, 2)
    expect(m.stanceCorners).toBe(0)
    expect(m.stanceJumps).toBe(0)
    // Ride height within the requested range
    expect(-analysis.kinematics!.envelope.maxY).toBeGreaterThan(50 - 0.05)
    expect(-analysis.kinematics!.envelope.minY).toBeLessThan(60 + 0.05)
  })

  it('keeps the swept area inside the space box', () => {
    const brief = testBrief({ space: { above: 70, front: 62, behind: 62 } })
    const outcome = solveProfile(mech, { brief, hardware: base.hardware, solver })
    expect(outcome.ok && outcome.feasible).toBe(true)
    if (!outcome.ok) return
    const design: Design = { ...base, foot: closeOutline(outcome.profile, outcome.x, mech, base.hardware, true) }
    const pts = analyzeDesign(design).swept()!.boundary.flatMap((b) => [b.p0, b.p3])
    expect(Math.max(...pts.map((p) => p.x))).toBeLessThan(62 + 0.05)
    expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThan(-62 - 0.05)
    expect(Math.max(...pts.map((p) => p.y))).toBeLessThan(70 + 0.05)
  })

  it('reports an impossible limit as infeasible instead of failing', () => {
    const brief = testBrief({ goals: { ...testBrief().goals, stride: { mode: 'limit', limit: 500, ideal: 500, acceptable: 500, importance: 2 } } })
    const outcome = solveProfile(mech, { brief, hardware: base.hardware, solver })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.feasible).toBe(false)
  })
})

describe('generator search (SPEC §10.7)', () => {
  it('returns verified, distinct candidates that meet the brief', () => {
    const brief = testBrief({ feet: [3, 4], pinHeight: { min: 34, max: 46 } })
    let progressCalls = 0
    const result = generateDesigns(base, brief, solver, { onProgress: () => progressCalls++ })
    expect(progressCalls).toBeGreaterThan(10)
    expect(result.candidates.length).toBeGreaterThan(1)
    const best = result.candidates[0]
    expect(best.misses).toEqual([])
    expect(best.values.stride).toBeGreaterThan(60 - 0.7)
    expect(best.values.bob).toBeLessThan(1)
    // Values are the full analysis of the returned design
    const m = analyzeDesign(best.design).kinematics!.metrics
    expect(best.values.bob).toBeCloseTo(m.bob, 9)
    // Dimensions are rounded to 0.1 mm
    expect(Math.abs(best.design.drive.L * 10 - Math.round(best.design.drive.L * 10))).toBeLessThan(1e-9)
    expect(Math.abs(best.design.constraint.pin.y * 10 - Math.round(best.design.constraint.pin.y * 10))).toBeLessThan(1e-9)
  }, 60_000)
})
