import { describe, expect, it } from 'vitest'
import { createDefaultDesign } from '../design/defaults'
import { flatFootOutline, presetContext, teardropOutline } from '../design/presets'
import type { Design } from '../design/schema'
import { degToRad, TAU } from '../math/angle'
import { rotate } from '../math/vec2'
import { evalCurve1D, evalCurve2D } from '../spline/curve'
import { fd, mulberry32, randomOutline } from '../test/helpers'
import { analyzeDesign } from './analyze'
import { CURVE_TOL } from './footCurves'

const withOutline = (design: Design, outline: Design['foot']['outline']): Design => ({ ...design, foot: { ...design.foot, outline } })

describe('worked example regression (SPEC §9)', () => {
  const analysis = analyzeDesign(createDefaultDesign())
  const k = analysis.kinematics!

  it('analyses without blocking issues', () => {
    expect(analysis.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(k).not.toBeNull()
  })

  it('matches the closed-form arc-foot values', () => {
    const m = k.metrics
    expect(m.bob).toBeCloseTo(3, 6)
    expect(m.strideStep).toBeCloseTo(22.41807, 4)
    expect(m.strideRev).toBeCloseTo(67.2542, 3)
    expect(m.direction).toBe(-1)
    expect(m.speedMax).toBeCloseTo(12.5217, 4)
    expect(m.speedMin).toBeCloseTo(7.1578, 4)
    expect(m.speedMean).toBeCloseTo(10.7038, 4)
    expect(m.speedRipple).toBeCloseTo(0.5011, 3)
    expect(m.handoffKink).toBeCloseTo(2 * 6 * Math.sin(Math.PI / 3), 6)
    expect(m.handoffSlip).toBeLessThan(1e-9)
    expect(m.tiltRange[1]).toBeCloseTo(Math.asin(6 / 40), 8)
    expect(m.stanceTiltRange[1]).toBeCloseTo(degToRad(6.89), 4)
    expect(m.stanceJumps).toBe(0)
    expect(m.stanceCorners).toBe(0)
  })

  it('traces a circle of radius L centred at (0, −R)', () => {
    for (let i = 0; i < 37; i++) {
      const phi = (TAU * i) / 37
      const c = evalCurve2D(k.curves.trace, phi)
      expect(Math.hypot(c.x, c.y + 50)).toBeCloseTo(6, 3)
    }
  })
})

describe('kinematic identities on free-form feet', () => {
  const base = createDefaultDesign()
  const rand = mulberry32(5)
  const designs: Design[] = [
    withOutline(base, flatFootOutline(presetContext(base))),
    withOutline(base, teardropOutline(presetContext(base))),
    { ...withOutline(base, flatFootOutline(presetContext(base), 45, 120, 30)), constraint: { kind: 'centerlineSlot', pin: { x: 4, y: 38 } } },
  ]

  it('derivatives match finite differences', () => {
    for (const design of designs) {
      const model = analyzeDesign(design).kinematics!.model
      for (let i = 0; i < 20; i++) {
        const phi = TAU * rand()
        const piece = model.pieceAt(phi)
        const s = (p: number) => model.sample(p, piece)
        const x = s(phi)
        expect(x.alphaD).toBeCloseTo(fd((p) => s(p).alpha, phi), 6)
        expect(x.yD).toBeCloseTo(fd((p) => s(p).y, phi), 5)
        expect(x.contactD.x).toBeCloseTo(fd((p) => s(p).contact.x, phi), 4)
        expect(x.vD).toBeCloseTo(fd((p) => s(p).v, phi), 4)
      }
    }
  })

  it('no-slip speed equals the velocity of the frozen material contact point', () => {
    for (const design of designs) {
      const model = analyzeDesign(design).kinematics!.model
      for (let i = 0; i < 20; i++) {
        const phi = TAU * rand()
        const x = model.sample(phi)
        const material = (p: number) => {
          const t = model.sample(p, x.piece)
          return t.p1.x + rotate(x.qLocal, t.alpha).x
        }
        expect(-x.v).toBeCloseTo(fd(material, phi), 5)
      }
    }
  })

  it('envelope matches the brute-force lowest foot and the fitted curves stay within tolerance', () => {
    for (const design of designs) {
      const k = analyzeDesign(design).kinematics!
      const { envelope } = k
      for (let i = 0; i < 200; i++) {
        const phi = envelope.start + envelope.period * (i / 200)
        expect(evalCurve1D(envelope.height, phi)).toBeCloseTo(k.envelopeAt(phi).y, 3)
        const y0 = k.model.sample(phi).y
        expect(Math.abs(evalCurve1D(k.curves.height, phi % TAU) - y0)).toBeLessThan(10 * CURVE_TOL)
      }
    }
  })

  it('stays finite on random non-convex feet', () => {
    for (let trial = 0; trial < 6; trial++) {
      const outline = randomOutline(rand, 6, 45, 0.7)
      const k = analyzeDesign(withOutline(base, outline)).kinematics!
      expect(Number.isFinite(k.metrics.bob)).toBe(true)
      expect(Number.isFinite(k.metrics.strideRev)).toBe(true)
    }
  })
})
