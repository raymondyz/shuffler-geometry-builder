import { describe, expect, it } from 'vitest'
import { dot, fromAngle } from '../math/vec2'
import { mulberry32, randomOutline } from '../test/helpers'
import { buildContactPieces } from './contactPieces'
import { compileOutline, flatten, orientCCW } from './outline'
import { pointAt, type Segment } from './segment'
import { buildSupportMap, hullFragments } from './supportMap'

function bruteSupport(segments: Segment[], psi: number): number {
  const n = fromAngle(psi)
  let best = -Infinity
  for (const seg of segments) {
    for (let i = 0; i <= 4000; i++) best = Math.max(best, dot(pointAt(seg, i / 4000), n))
  }
  return best
}

describe('support map', () => {
  it('matches brute force on random (often non-convex) outlines', () => {
    const rand = mulberry32(7)
    for (let trial = 0; trial < 12; trial++) {
      const ccw = orientCCW(compileOutline(randomOutline(rand, 5 + (trial % 5))))
      const map = buildSupportMap(buildContactPieces(ccw))
      for (let i = 0; i < 90; i++) {
        const psi = -Math.PI + (2 * Math.PI * (i + rand())) / 90
        expect(map.evaluate(psi).h).toBeCloseTo(bruteSupport(ccw, psi), 4)
      }
    }
  })

  it('reports h′(ψ) = q*·n′(ψ) consistently with the support point', () => {
    const rand = mulberry32(11)
    const ccw = orientCCW(compileOutline(randomOutline(rand)))
    const map = buildSupportMap(buildContactPieces(ccw))
    for (let i = 0; i < 50; i++) {
      const psi = -Math.PI + (2 * Math.PI * i) / 50
      const s = map.evaluate(psi)
      expect(s.h).toBeCloseTo(dot(s.q, fromAngle(psi)), 10)
      expect(s.hd).toBeCloseTo(dot(s.q, { x: -Math.sin(psi), y: Math.cos(psi) }), 10)
    }
  })

  it('handles arcs and corners: a circle has constant support', () => {
    const r = 25
    const circle: Segment[] = [
      { kind: 'arc', center: { x: 0, y: 0 }, radius: r, startAngle: 0, sweep: Math.PI },
      { kind: 'arc', center: { x: 0, y: 0 }, radius: r, startAngle: Math.PI, sweep: Math.PI },
    ]
    const map = buildSupportMap(buildContactPieces(circle))
    for (let i = 0; i < 40; i++) {
      const s = map.evaluate(-Math.PI + (2 * Math.PI * i) / 40)
      expect(s.h).toBeCloseTo(r, 12)
      expect(s.rho).toBeCloseTo(r, 12)
    }
    const square: Segment[] = [
      { kind: 'line', p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 } },
      { kind: 'line', p0: { x: 10, y: 0 }, p1: { x: 10, y: 10 } },
      { kind: 'line', p0: { x: 10, y: 10 }, p1: { x: 0, y: 10 } },
      { kind: 'line', p0: { x: 0, y: 10 }, p1: { x: 0, y: 0 } },
    ]
    const sq = buildSupportMap(buildContactPieces(square))
    expect(sq.breaks.filter((b) => !b.continuous)).toHaveLength(4)
    expect(sq.evaluate(-Math.PI / 2 + 0.1).q).toEqual({ x: 10, y: 0 })
  })

  it('builds a closed hull that encloses every outline point', () => {
    const rand = mulberry32(3)
    const ccw = orientCCW(compileOutline(randomOutline(rand, 8, 40, 0.8)))
    const map = buildSupportMap(buildContactPieces(ccw))
    const hull = flatten(hullFragments(map, ccw, -Math.PI, Math.PI), 64)
    for (let i = 0; i < 60; i++) {
      const psi = (2 * Math.PI * i) / 60
      const n = fromAngle(psi)
      const hullMax = Math.max(...hull.map((q) => dot(q, n)))
      expect(hullMax).toBeCloseTo(map.evaluate(psi).h, 2)
    }
  })
})
