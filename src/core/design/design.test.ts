import { describe, expect, it } from 'vitest'
import { analyzeDesign } from '../analysis/analyze'
import { compileEdge, compileOutline } from '../curves/outline'
import { pointAt } from '../curves/segment'
import { distance } from '../math/vec2'
import { buildParts } from '../export/parts'
import { exportDxf } from '../export/dxf'
import { exportSvg } from '../export/svg'
import { createDefaultDesign } from './defaults'
import { boreRadius, camRadius, shaftClearRadius } from './hardware'
import { deleteNode, insertNode, moveHandle, setEdgeKind } from './outlineEdit'
import { footPresets, presetContext } from './presets'
import { parseDesign, serializeDesign } from './serialize'

describe('design files', () => {
  it('round-trips through JSON', () => {
    const design = createDefaultDesign()
    expect(parseDesign(serializeDesign(design))).toEqual(design)
  })

  it('rejects malformed files with a readable message', () => {
    expect(() => parseDesign('{}')).toThrow(/schemaVersion/)
    expect(() => parseDesign('not json')).toThrow(/JSON/)
  })

  it('still opens older files that stored a cam diameter', () => {
    const design = createDefaultDesign()
    const old = JSON.parse(serializeDesign(design))
    old.hardware.camDiameter = 30
    expect(parseDesign(JSON.stringify(old))).toEqual(design)
  })
})

describe('cam sizing', () => {
  it('always fits the shaft with the minimum wall as margin', () => {
    const base = createDefaultDesign()
    for (const L of [2, 6, 15, 30]) {
      for (const shaft of [{ kind: 'hex' as const, size: 8 }, { kind: 'round' as const, size: 10 }]) {
        const design = { ...base, drive: { kind: 'eccentric' as const, L }, hardware: { ...base.hardware, shaft } }
        const wall = camRadius(design) - (L + shaftClearRadius(design.hardware))
        expect(wall).toBeCloseTo(design.hardware.minWall, 12)
      }
    }
  })

  it('never reports a cam wall problem when L grows', () => {
    const base = createDefaultDesign()
    const design = { ...base, drive: { kind: 'eccentric' as const, L: 14 }, constraint: { kind: 'centerlineSlot' as const, pin: { x: 0, y: 70 } } }
    expect(analyzeDesign(design).issues.map((i) => i.code)).not.toContain('cam-wall')
    expect(boreRadius(design)).toBeCloseTo(14 + 8 / Math.sqrt(3) + 0.2 + 2 + 0.2, 12)
  })
})

describe('presets', () => {
  it('produce valid, convex-stance feet for the default mechanism', () => {
    const base = createDefaultDesign()
    for (const preset of footPresets) {
      const analysis = analyzeDesign({ ...base, foot: { outline: preset.create(presetContext(base), 50), mirror: false } })
      expect(analysis.issues.filter((i) => i.level === 'error'), preset.id).toEqual([])
      expect(analysis.kinematics?.metrics.stanceJumps, preset.id).toBe(0)
    }
  })
})

describe('outline editing', () => {
  const outline = createDefaultDesign().foot.outline

  it('inserting an anchor keeps the shape', () => {
    for (let edge = 0; edge < outline.edges.length; edge++) {
      const before = compileEdge(outline, edge)
      const { outline: after } = insertNode(outline, edge, 0.37)
      const left = compileEdge(after, edge)
      const right = compileEdge(after, edge + 1)
      for (const t of [0.1, 0.5, 0.9]) {
        const p = pointAt(before, 0.37 * t)
        expect(distance(pointAt(left, t), p)).toBeLessThan(1e-9)
        const q = pointAt(before, 0.37 + 0.63 * t)
        expect(distance(pointAt(right, t), q)).toBeLessThan(1e-9)
      }
    }
  })

  it('deleting an anchor merges its edges', () => {
    const { outline: more, id } = insertNode(outline, 1, 0.5)
    expect(deleteNode(more, id).nodes.length).toBe(outline.nodes.length)
    expect(compileOutline(deleteNode(more, id))).toHaveLength(outline.edges.length)
  })

  it('smooth nodes keep handles collinear', () => {
    const smooth = { ...outline, nodes: outline.nodes.map((n) => ({ ...n, mode: 'smooth' as const })) }
    const id = smooth.nodes[2].id
    const moved = moveHandle(smooth, id, 'out', { x: 3, y: 4 })
    const n = moved.nodes[2]
    expect(n.hIn.x * n.hOut.y - n.hIn.y * n.hOut.x).toBeCloseTo(0, 12)
  })

  it('converting an arc edge to a cubic keeps its shape closely', () => {
    const arcEdge = outline.edges.findIndex((e) => e.kind === 'arc')
    const arc = compileEdge(outline, arcEdge)
    const cubic = compileEdge(setEdgeKind(outline, arcEdge, 'cubic'), arcEdge)
    expect(distance(pointAt(arc, 0.5), pointAt(cubic, 0.5))).toBeLessThan(0.05)
  })
})

describe('export', () => {
  const analysis = analyzeDesign(createDefaultDesign())
  const parts = buildParts(analysis, { includeReference: true })

  it('lays out foot, cam, frame and reference parts', () => {
    expect(parts.map((p) => p.layer)).toEqual(['foot', 'cam', 'frame', 'reference'])
  })

  it('writes SVG with exact arcs and cubics', () => {
    const svg = exportSvg(parts)
    expect(svg).toContain('width="')
    expect(svg).toMatch(/ A /)
    expect(svg).toMatch(/ C /)
  })

  it('writes DXF with splines, arcs and mm units', () => {
    const dxf = exportDxf(parts)
    expect(dxf).toContain('SPLINE')
    expect(dxf).toContain('ARC')
    expect(dxf).toContain('$INSUNITS')
  })
})
