import { describe, expect, it } from 'vitest'
import { analyzeDesign } from '../analysis/analyze'
import { compileOutline, signedArea, type Outline } from '../curves/outline'
import { mulberry32, randomOutline } from '../test/helpers'
import { createDefaultDesign } from './defaults'
import { mirrorOps, symmetrize } from './mirror'
import { parseDesign, serializeDesign } from './serialize'

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

/** Every anchor j mirrors anchor n−j, handles swap and reflect, and edges pair up. */
function expectSymmetric(o: Outline) {
  const n = o.nodes.length
  expect(n % 2).toBe(0)
  expect(o.nodes[0].p.x).toBe(0)
  expect(o.nodes[n / 2].p.x).toBe(0)
  for (let j = 0; j < n; j++) {
    const a = o.nodes[j]
    const b = o.nodes[(n - j) % n]
    expect(close(a.p.x, -b.p.x) && close(a.p.y, b.p.y)).toBe(true)
    expect(close(a.hOut.x, -b.hIn.x) && close(a.hOut.y, b.hIn.y)).toBe(true)
  }
  for (let i = 0; i < n; i++) {
    expect(o.edges[n - 1 - i].kind).toBe(o.edges[i].kind)
    expect(o.edges[n - 1 - i].bulge).toBeCloseTo(o.edges[i].bulge, 12)
  }
  expect(new Set(o.nodes.map((nd) => nd.id)).size).toBe(n)
}

describe('symmetrize', () => {
  it('keeps the shape of an already symmetric foot', () => {
    const outline = createDefaultDesign().foot.outline
    const sym = symmetrize(outline)!
    expectSymmetric(sym)
    expect(signedArea(compileOutline(sym))).toBeCloseTo(signedArea(compileOutline(outline)), 6)
  })

  it('makes any outline that crosses the centreline symmetric', () => {
    const rand = mulberry32(21)
    for (let trial = 0; trial < 8; trial++) {
      const sym = symmetrize(randomOutline(rand, 7, 40, 0.5))
      expect(sym).not.toBeNull()
      expectSymmetric(sym!)
    }
  })

  it('is idempotent', () => {
    const once = symmetrize(createDefaultDesign().foot.outline)!
    expect(symmetrize(once)).toEqual(once)
  })

  it('refuses outlines entirely on one side', () => {
    const outline = createDefaultDesign().foot.outline
    const shifted = { ...outline, nodes: outline.nodes.map((nd) => ({ ...nd, p: { x: nd.p.x + 200, y: nd.p.y } })) }
    expect(symmetrize(shifted)).toBeNull()
  })
})

describe('mirrored editing', () => {
  const base = symmetrize(createDefaultDesign().foot.outline)!
  const n = base.nodes.length

  it('moving a node on either side moves its twin', () => {
    const right = mirrorOps.moveNode(base, base.nodes[1].id, { x: 35, y: -30 })
    expectSymmetric(right)
    expect(right.nodes[n - 1].p).toEqual({ x: -35, y: -30 })
    const left = mirrorOps.moveNode(base, base.nodes[n - 1].id, { x: -33, y: -31 })
    expectSymmetric(left)
    expect(left.nodes[1].p).toEqual({ x: 33, y: -31 })
  })

  it('keeps axis anchors on the centreline with horizontal smooth handles', () => {
    const moved = mirrorOps.moveNode(base, base.nodes[0].id, { x: 12, y: -55 })
    expect(moved.nodes[0].p).toEqual({ x: 0, y: -55 })
    const handled = mirrorOps.moveHandle(moved, moved.nodes[0].id, 'out', { x: 10, y: 4 })
    expectSymmetric(handled)
    expect(handled.nodes[0].hOut.y).toBe(0)
  })

  it('handle, mode and edge edits stay symmetric', () => {
    let o = mirrorOps.moveHandle(base, base.nodes[n - 2].id, 'in', { x: 5, y: 9 })
    expectSymmetric(o)
    o = mirrorOps.setNodeMode(o, o.nodes[n - 2].id, 'symmetric')
    expectSymmetric(o)
    o = mirrorOps.setEdgeKind(o, n - 1, 'line')
    expectSymmetric(o)
    o = mirrorOps.setEdgeKind(o, 0, 'arc')
    o = mirrorOps.setEdgeBulge(o, n - 1, 0.3)
    expectSymmetric(o)
    expect(o.edges[0].bulge).toBeCloseTo(0.3, 12)
  })

  it('inserting and deleting work in pairs', () => {
    const { outline: more, id } = mirrorOps.insertNode(base, n - 2, 0.4)
    expect(more.nodes.length).toBe(n + 2)
    expectSymmetric(more)
    expect(more.nodes.some((nd) => nd.id === id)).toBe(true)
    const fewer = mirrorOps.deleteNode(more, id)
    expect(fewer.nodes.length).toBe(n)
    expectSymmetric(fewer)
    expect(mirrorOps.canDelete(base, base.nodes[0].id)).toBe(false)
    expect(mirrorOps.deleteNode(base, base.nodes[0].id)).toBe(base)
  })

  it('does not change the analysis of a symmetric foot', () => {
    const design = createDefaultDesign()
    const plain = analyzeDesign(design).kinematics!.metrics
    const mirrored = analyzeDesign({ ...design, foot: { outline: base, mirror: true } }).kinematics!.metrics
    expect(mirrored.bob).toBeCloseTo(plain.bob, 9)
    expect(mirrored.strideRev).toBeCloseTo(plain.strideRev, 9)
  })

  it('round-trips through a design file', () => {
    const design = { ...createDefaultDesign(), name: 'Beetle feet', foot: { outline: base, mirror: true } }
    expect(parseDesign(serializeDesign(design))).toEqual(design)
  })
})
