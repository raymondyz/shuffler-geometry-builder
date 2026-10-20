import { describe, expect, it } from 'vitest'
import { evalCurve1D, fitCurve1D, pieceToBezier } from './curve'

describe('Hermite fitting', () => {
  it('fits a smooth function to tolerance with few pieces', () => {
    const f = (t: number) => ({ v: Math.sin(3 * t) + 0.2 * t * t, d: 3 * Math.cos(3 * t) + 0.4 * t })
    const tol = 1e-6
    const curve = { pieces: fitCurve1D(f, 0, 4, tol) }
    expect(curve.pieces.length).toBeLessThan(160)
    for (let i = 0; i <= 500; i++) {
      const t = (4 * i) / 500
      expect(Math.abs(evalCurve1D(curve, t) - f(t).v)).toBeLessThan(2 * tol)
    }
  })

  it('converts exactly to a Bézier graph', () => {
    const [piece] = fitCurve1D((t) => ({ v: t * t * t, d: 3 * t * t }), 0, 1, 1e-9)
    const b = pieceToBezier(piece)
    // A cubic is reproduced exactly: Bézier control values of t³ are 0, 0, 0, 1
    expect(b.p1.y).toBeCloseTo(0, 12)
    expect(b.p2.y).toBeCloseTo(0, 12)
    expect(b.p3.y).toBeCloseTo(1, 12)
  })
})
