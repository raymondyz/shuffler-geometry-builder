import { describe, expect, it } from 'vitest'
import { nearestParameter } from '../../curves/outline'
import { endPoint, pointAt, startPoint, type Segment } from '../../curves/segment'
import { distance, type Vec2 } from '../../math/vec2'
import { mulberry32 } from '../../test/helpers'
import { arc, circle, dxfText, entity, line, lwpolyline, spline } from '../../test/dxf'
import { interpretDrawing } from './entities'
import { splineSegments } from './nurbs'
import { readDxf } from './reader'

const segmentsOf = (text: string): Segment[] => interpretDrawing(readDxf(text)).segments.map((s) => s.seg)

const near = (a: Vec2, b: Vec2, tol = 1e-9) => expect(distance(a, b)).toBeLessThan(tol)

const distanceToChain = (p: Vec2, chain: Segment[]) => Math.min(...chain.map((s) => nearestParameter(s, p).distance))

/** Reference NURBS evaluation (de Boor on homogeneous points) */
function deBoor(points: Vec2[], weights: number[], knots: number[], p: number, u: number): Vec2 {
  const n = points.length - 1
  let k = p
  while (k < n && u >= knots[k + 1]) k++
  const d = Array.from({ length: p + 1 }, (_, j) => {
    const i = k - p + j
    const w = weights[i] ?? 1
    return { x: points[i].x * w, y: points[i].y * w, w }
  })
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j
      const a = (u - knots[i]) / (knots[i + p - r + 1] - knots[i])
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w }
    }
  }
  return { x: d[p].x / d[p].w, y: d[p].y / d[p].w }
}

describe('reading DXF files', () => {
  it('rejects files that are not ASCII DXF, with a readable message', () => {
    expect(() => readDxf('AutoCAD Binary DXF\r\n\x1a\0...')).toThrow(/binary DXF/)
    expect(() => readDxf('AC1027\0\0\0garbage')).toThrow(/DWG/)
    expect(() => readDxf('hello world\nthis is text\n')).toThrow(/isn't a DXF/)
    expect(() => readDxf('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n')).toThrow(/isn't a DXF/)
    expect(() => readDxf(dxfText([line({ x: 0, y: 0 }, { x: 1, y: 0 })]).replace('\n10\n', '\nten\n'))).toThrow(/damaged near line/)
  })

  it('accepts CRLF line ends, padded group codes, a missing EOF and a byte-order mark', () => {
    const text = dxfText([line({ x: 0, y: 0 }, { x: 5, y: 1 })])
    const messy = '﻿' + text.split('\n').map((l, i) => (i % 2 === 0 ? `  ${l}` : l)).join('\r\n').replace(/\r\n {2}0\r\nEOF$/, '')
    const segs = segmentsOf(messy)
    expect(segs).toHaveLength(1)
    near(endPoint(segs[0]), { x: 5, y: 1 })
  })

  it('reads $INSUNITS and the off and frozen layers', () => {
    const drawing = readDxf(dxfText([], { units: 1, layers: [{ name: 'Off', color: -7 }, { name: 'Frozen', flags: 1 }, { name: 'On' }] }))
    expect(drawing.insUnits).toBe(1)
    expect(drawing.layers.get('OFF')?.hidden).toBe(true)
    expect(drawing.layers.get('FROZEN')?.hidden).toBe(true)
    expect(drawing.layers.get('ON')?.hidden).toBe(false)
  })
})

describe('interpreting entities', () => {
  it('turns bulge polylines into lines and arcs, with the DXF bulge convention', () => {
    // A 10 × 10 square whose top edge bulges outward as a half circle (bulge 1 = 180° counter-clockwise)
    const segs = segmentsOf(dxfText([lwpolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10, bulge: 1 }, { x: 0, y: 10 }], true)]))
    expect(segs.map((s) => s.kind)).toEqual(['line', 'line', 'arc', 'line'])
    const top = segs[2] as Extract<Segment, { kind: 'arc' }>
    expect(top.radius).toBeCloseTo(5, 12)
    near(pointAt(top, 0.5), { x: 5, y: 15 })
  })

  it('reads R12 polylines from their VERTEX records, skipping spline frame points', () => {
    const vertex = (x: number, y: number, bulge = 0, flags = 0) => entity('VERTEX', [[10, x], [20, y], [42, bulge], [70, flags]])
    const text = dxfText([
      [...entity('POLYLINE', [[66, 1], [70, 1]]), ...vertex(0, 0), ...vertex(10, 0, 1), ...vertex(10, 10), ...vertex(99, 99, 0, 16), ...vertex(0, 10), '0', 'SEQEND'],
    ])
    const segs = segmentsOf(text)
    expect(segs.map((s) => s.kind)).toEqual(['line', 'arc', 'line', 'line'])
    near(endPoint(segs[3]), { x: 0, y: 0 })
  })

  it('mirrors x for entities extruded along −Z, so their arcs run clockwise', () => {
    const it = interpretDrawing(readDxf(dxfText([arc({ x: 10, y: 0 }, 5, 0, 90, [[210, 0], [220, 0], [230, -1]]), circle({ x: 0, y: 0 }, 1, [[210, 1], [220, 0], [230, 0]])])))
    expect(it.tilted).toBe(1)
    const a = it.segments[0].seg as Extract<Segment, { kind: 'arc' }>
    near(startPoint(a), { x: -15, y: 0 })
    near(endPoint(a), { x: -10, y: 5 })
    expect(a.sweep).toBeLessThan(0)
  })

  it('expands block references with their insertion point, rotation, mirroring and layer', () => {
    const block = { name: 'B', base: { x: 1, y: 0 }, entities: [line({ x: 1, y: 0 }, { x: 11, y: 0 })] }
    const insert = entity('INSERT', [[2, 'B'], [10, 5], [20, 5], [41, -2], [42, 1], [50, 90]], 'HIDE')
    const it = interpretDrawing(readDxf(dxfText([insert], { blocks: [block], layers: [{ name: 'HIDE', color: -1 }] })))
    expect(it.segments).toHaveLength(1)
    const s = it.segments[0]
    near(startPoint(s.seg), { x: 5, y: 5 })
    // Scale (−2, 1) then a quarter turn: (10, 0) → (−20, 0) → (0, −20)
    near(endPoint(s.seg), { x: 5, y: -15 })
    expect(s.layer).toBe('HIDE')
    expect(s.hidden).toBe(true)
  })

  it('stops at block cycles and notes missing blocks', () => {
    const loop = { name: 'A', entities: [entity('INSERT', [[2, 'A'], [10, 1], [20, 0]])] }
    const it = interpretDrawing(readDxf(dxfText([entity('INSERT', [[2, 'A']]), entity('INSERT', [[2, 'Nope']])], { blocks: [loop] })))
    expect(it.deepBlocks).toBeGreaterThan(0)
    expect(it.missingBlocks).toEqual(['Nope'])
  })

  it('counts entity types it ignores', () => {
    const it = interpretDrawing(readDxf(dxfText([entity('MTEXT', [[1, 'note']]), entity('DIMENSION', []), line({ x: 0, y: 0 }, { x: 1, y: 1 })])))
    expect(it.ignored.get('MTEXT')).toBe(1)
    expect(it.ignored.get('DIMENSION')).toBe(1)
    expect(it.segments).toHaveLength(1)
  })

  it('converts ellipses: exact arcs when circular, cubics within 0.001 mm otherwise', () => {
    const full = (ratio: number) => entity('ELLIPSE', [[10, 2], [20, 3], [11, 40], [21, 0], [40, ratio], [41, 0], [42, 2 * Math.PI]])
    expect(segmentsOf(dxfText([full(1)])).every((s) => s.kind === 'arc')).toBe(true)
    const it = interpretDrawing(readDxf(dxfText([full(0.5)])))
    expect(it.approximated).toBe(1)
    for (const { seg } of it.segments) {
      for (let k = 0; k <= 20; k++) {
        const p = pointAt(seg, k / 20)
        const e = Math.hypot((p.x - 2) / 40, (p.y - 3) / 20)
        expect(Math.abs(e - 1) * 20).toBeLessThan(1e-3)
      }
    }
  })
})

describe('splines', () => {
  const rand = mulberry32(7)
  const randomPoints = (n: number) => Array.from({ length: n }, () => ({ x: rand() * 100, y: rand() * 100 }))

  const convert = (degree: number, knots: number[], points: Vec2[], weights: number[] = []) =>
    splineSegments({ degree, knots, points, weights, fitPoints: [], startTangent: null, endTangent: null }, 1e-3)!

  /** Every point of the reference curve is on the converted chain (to the precision of the nearest-point search). */
  const check = (degree: number, knots: number[], points: Vec2[], weights: number[], tol: number) => {
    const out = convert(degree, knots, points, weights)
    const [u0, u1] = [knots[degree], knots[points.length]]
    for (let k = 0; k <= 200; k++) {
      const u = u0 + ((u1 - u0) * k) / 200
      expect(distanceToChain(deBoor(points, weights, knots, degree, Math.min(u, u1 - 1e-12)), out.segments)).toBeLessThan(tol)
    }
    return out
  }

  /** Exact conversion: piece i, at local t, equals the spline at the same parameter of its knot span. */
  const checkExact = (degree: number, knots: number[], points: Vec2[]) => {
    const out = convert(degree, knots, points)
    expect(out.approximated).toBe(false)
    const spans = knots.flatMap((u, i) => (i >= degree && i < points.length && knots[i + 1] > u ? [[u, knots[i + 1]]] : []))
    expect(out.segments).toHaveLength(spans.length)
    out.segments.forEach((seg, i) => {
      const [a, b] = spans[i]
      for (let k = 0; k <= 10; k++) near(pointAt(seg, k / 10), deBoor(points, [], knots, degree, Math.min(a + ((b - a) * k) / 10, b - 1e-13)), 1e-9)
    })
    return out
  }

  it('splits clamped and unclamped splines of degree 1–3 into exact pieces', () => {
    expect(checkExact(3, [0, 0, 0, 0, 1, 2, 3, 3, 3, 3], randomPoints(6)).segments).toHaveLength(3)
    expect(checkExact(3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], randomPoints(6)).segments).toHaveLength(3)
    checkExact(3, [0, 0, 0, 0, 1, 1, 2, 2, 2, 2], randomPoints(6))
    checkExact(2, [0, 0, 0, 0.3, 1, 1, 1], randomPoints(4))
    expect(checkExact(1, [0, 0, 1, 2, 2], randomPoints(3)).segments.every((s) => s.kind === 'line')).toBe(true)
  })

  it('turns a rational quadratic circle into exact arcs', () => {
    const s = Math.SQRT1_2
    const c = { x: 3, y: 4 }
    const pts = [[10, 0], [10, 10], [0, 10], [-10, 10], [-10, 0], [-10, -10], [0, -10], [10, -10], [10, 0]].map(([x, y]) => ({ x: c.x + x, y: c.y + y }))
    const out = check(2, [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4], pts, [1, s, 1, s, 1, s, 1, s, 1], 1e-7)
    expect(out.approximated).toBe(false)
    expect(out.segments).toHaveLength(4)
    for (const seg of out.segments) {
      expect(seg.kind).toBe('arc')
      if (seg.kind === 'arc') {
        expect(seg.radius).toBeCloseTo(10, 9)
        near(seg.center, c)
      }
    }
  })

  it('fits higher-degree and general rational splines within 0.001 mm', () => {
    const quintic = check(5, [0, 0, 0, 0, 0, 0, 0.5, 1, 1, 1, 1, 1, 1], randomPoints(7), [], 1.1e-3)
    expect(quintic.approximated).toBe(true)
    const rational = check(3, [0, 0, 0, 0, 1, 1, 1, 1], randomPoints(4), [1, 3, 0.5, 1], 1.1e-3)
    expect(rational.approximated).toBe(true)
  })

  it('interpolates splines given only fit points, through every point', () => {
    const fit = randomPoints(6)
    const out = splineSegments({ degree: 3, knots: [], points: [], weights: [], fitPoints: fit, startTangent: null, endTangent: null }, 1e-3)!
    expect(out.approximated).toBe(true)
    expect(out.segments).toHaveLength(5)
    out.segments.forEach((s, i) => {
      near(startPoint(s), fit[i])
      near(endPoint(s), fit[i + 1])
    })
  })

  it('rejects an invalid knot vector', () => {
    expect(splineSegments({ degree: 3, knots: [0, 0, 1], points: randomPoints(4), weights: [], fitPoints: [], startTangent: null, endTangent: null }, 1e-3)).toBeNull()
    const it = interpretDrawing(readDxf(dxfText([spline(3, [0, 0, 0, 1, 0.5, 1, 1, 1], randomPoints(4))])))
    expect(it.invalid).toBe(1)
  })
})
