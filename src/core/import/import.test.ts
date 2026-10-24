import { describe, expect, it } from 'vitest'
import foot1 from '../../../docs/test_foot_1.DXF?raw'
import foot2 from '../../../docs/test_foot_2.DXF?raw'
import { analyzeDesign } from '../analysis/analyze'
import { compileOutline, flatten, nearestParameter, type Outline } from '../curves/outline'
import { pointAt, reverseSegment, type ArcSegment, type Segment } from '../curves/segment'
import { createDefaultDesign } from '../design/defaults'
import { boreRadius, slotRadius } from '../design/hardware'
import { symmetrize } from '../design/mirror'
import { moveNode } from '../design/outlineEdit'
import { arcFootOutline, footPresets, presetContext } from '../design/presets'
import type { Design } from '../design/schema'
import { buildParts } from '../export/parts'
import { exportDxf } from '../export/dxf'
import { degToRad } from '../math/angle'
import type { Vec2 } from '../math/vec2'
import { circle, dxfText, line, lwpolyline, segmentEntities } from '../test/dxf'
import { DEFAULT_IMPORT_OPTIONS, parseDxfText, previewImport, type ImportOptions } from './importFoot'
import { findLoops } from './loops'
import { applyAffine, compose, IDENTITY, rotation, scaling, transformSegment, translation, type Affine } from './segments'

const base = createDefaultDesign()

const preview = (text: string, design: Design = base, options: Partial<ImportOptions> = {}) =>
  previewImport(parseDxfText(text, 'test.dxf'), design, { ...DEFAULT_IMPORT_OPTIONS, ...options })

/** Largest distance between two closed chains, both ways (to the ~1e-8 mm precision of the nearest-point search). */
function hausdorff(a: Segment[], b: Segment[]): number {
  const oneWay = (from: Segment[], to: Segment[]) =>
    Math.max(...from.flatMap((s) => Array.from({ length: 17 }, (_, k) => pointAt(s, k / 16))).map((p) => Math.min(...to.map((t) => nearestParameter(t, p).distance))))
  return Math.max(oneWay(a, b), oneWay(b, a))
}

const outlineOf = (design: Design | null): Segment[] => compileOutline(design!.foot.outline)

const withOutline = (outline: Outline, mirror: boolean): Design => ({ ...base, foot: { outline, mirror } })

const slotOf = (design: Design) => analyzeDesign(design).mechanism.constraint.slotOutline(slotRadius(design.hardware))

const moved = (segments: Segment[], m: Affine) => segments.flatMap((s) => transformSegment(s, m, 1e-6))

/** A foot as drawn in CAD (outline, then slot, then bore), moved by `m` */
function footEntities(design: Design, m: Affine = IDENTITY): string[][] {
  return [
    ...segmentEntities(moved(compileOutline(design.foot.outline), m)),
    ...segmentEntities(moved(slotOf(design), m)),
    circle(applyAffine(m, { x: 0, y: 0 }), boreRadius(design) * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))),
  ]
}

const exported = (design: Design) => exportDxf(buildParts(analyzeDesign(design), { includeReference: true }))

const presetDesigns = footPresets.map((p) => ({ id: p.id, design: withOutline(symmetrize(p.create(presetContext(base), 50))!, true) }))

/** The arc foot with one cap anchor moved: an asymmetric foot */
const asymmetric = (() => {
  const o = arcFootOutline(presetContext(base), 50, 70)
  const cap = o.nodes[2]
  return withOutline(moveNode(o, cap.id, { x: cap.p.x + 4, y: cap.p.y - 3 }), false)
})()

describe('importing the sample SolidWorks feet', () => {
  it('finds P1 and the slot, adopts the file mechanism and keeps the foot symmetric', () => {
    const p = preview(foot1)
    expect(p.error).toBeNull()
    expect(p.units).toBe('mm')
    expect(p.slotFixed).toBe(true)
    expect(p.symmetric).toBe(true)
    expect(p.mechanism?.file.pinDistance).toBeCloseTo(36, 9)
    expect(p.mechanism?.file.L).toBeCloseTo(8, 9)
    expect(p.mechanism?.file.slotWidth).toBeCloseTo(7.004, 9)
    expect(p.mechanism?.file.boreDiameter).toBeCloseTo(35.4, 9)
    const d = p.design!
    expect(d.drive.L).toBeCloseTo(8, 9)
    expect(d.constraint.pin.y).toBeCloseTo(36, 9)
    expect(d.foot.mirror).toBe(true)
    // The bottom is an 80 mm arc whose centre is 35.9 mm above P1 (P1 is at y = 7 in the drawing)
    expect(Math.min(...flatten(outlineOf(d), 64).map((q) => q.y))).toBeCloseTo(42.9075366012 - 80 - 7, 6)
    expect(analyzeDesign(d).issues).toEqual([])
    const notes = p.notes.join(' ')
    expect(notes).toMatch(/bore in the file is Ø35\.40 mm/)
    expect(notes).toMatch(/Ignored 2 texts/)
  })

  it('imports the pronged foot, which rocks from prong to prong', () => {
    const p = preview(foot2)
    expect(p.design?.foot.mirror).toBe(true)
    expect(p.anchors).toBe(18)
    const codes = analyzeDesign(p.design!).issues.map((i) => i.code)
    expect(codes).toContain('stance-corner')
    expect(codes).toContain('stance-jump')
  })

  it('can keep the design mechanism instead', () => {
    const d = preview(foot1, base, { keepMechanism: true }).design!
    expect(d.drive.L).toBe(base.drive.L)
    expect(d.constraint.pin).toEqual(base.constraint.pin)
  })
})

describe('round trip through our own DXF export', () => {
  for (const { id, design } of [...presetDesigns, { id: 'asymmetric', design: asymmetric }]) {
    it(`gives back the ${id} foot`, () => {
      const p = preview(exported(design), design)
      expect(p.error).toBeNull()
      expect(p.notes).toContain('Used the FOOT layer only.')
      expect(p.mechanism).toBeNull()
      expect(p.design?.foot.mirror).toBe(design.foot.mirror)
      expect(hausdorff(outlineOf(p.design), outlineOf(design))).toBeLessThan(1e-6)
      const before = analyzeDesign(design).kinematics!.metrics
      const after = analyzeDesign(p.design!).kinematics!.metrics
      expect(after.bob).toBeCloseTo(before.bob, 6)
      expect(after.strideRev).toBeCloseTo(before.strideRev, 6)
    })
  }
})

describe('placing the foot', () => {
  const move = compose(translation({ x: 120, y: -45 }), compose(rotation(degToRad(37)), scaling(-1, 1)))
  const arcFoot = presetDesigns[0].design

  it('undoes any rotation, mirroring and position using the bore and slot', () => {
    const p = preview(dxfText(footEntities(arcFoot, move)), arcFoot)
    expect(p.slotFixed).toBe(true)
    expect(hausdorff(outlineOf(p.design), outlineOf(arcFoot))).toBeLessThan(1e-6)
  })

  it('needs Flip to restore an asymmetric foot drawn mirrored', () => {
    const text = dxfText(footEntities(asymmetric, move))
    expect(hausdorff(outlineOf(preview(text, asymmetric).design), outlineOf(asymmetric))).toBeGreaterThan(1)
    const flipped = preview(text, asymmetric, { flip: true })
    expect(flipped.design?.foot.mirror).toBe(false)
    expect(hausdorff(outlineOf(flipped.design), outlineOf(asymmetric))).toBeLessThan(1e-6)
  })

  it('uses the drawing origin as P1 when there is no bore, and asks for it when the origin is outside', () => {
    const outline = outlineOf(arcFoot)
    const atOrigin = preview(dxfText(segmentEntities(outline)), arcFoot)
    expect(atOrigin.needsP1).toBe(false)
    expect(hausdorff(outlineOf(atOrigin.design), outline)).toBeLessThan(1e-6)

    const shifted = dxfText(segmentEntities(moved(outline, translation({ x: 300, y: 0 }))))
    const asks = preview(shifted, arcFoot)
    expect(asks.needsP1).toBe(true)
    expect(asks.design).toBeNull()
    const picked = preview(shifted, arcFoot, { pickedP1: { x: 300, y: 0 } })
    expect(hausdorff(outlineOf(picked.design), outline)).toBeLessThan(1e-6)
  })

  it('reports an offset slot and uses it only for orientation', () => {
    const n = arcFoot.foot.outline.edges.length
    const slot = slotOf(arcFoot)
    const entities = footEntities(arcFoot)
    const text = dxfText([...entities.slice(0, n), ...segmentEntities(moved(slot, translation({ x: 2, y: 0 }))), ...entities.slice(n + slot.length)])
    const p = preview(text, arcFoot)
    expect(p.mechanism).toBeNull()
    expect(p.notes.join(' ')).toMatch(/off the bore's centreline/)
  })

  it('asks which shape is the foot when there are several', () => {
    const text = dxfText([...footEntities(arcFoot), ...footEntities(arcFoot, translation({ x: 200, y: 0 }))])
    const p = preview(text, arcFoot)
    expect(p.parts).toHaveLength(2)
    expect(p.partAmbiguous).toBe(true)
    expect(preview(text, arcFoot, { part: 1 }).part).toBe(1)
  })
})

describe('units', () => {
  const design = presetDesigns[1].design
  const inches = scaling(1 / 25.4)

  it('scales by $INSUNITS', () => {
    const p = preview(dxfText(footEntities(design, inches), { units: 1 }), design)
    expect(p.units).toBe('in')
    expect(hausdorff(outlineOf(p.design), outlineOf(design))).toBeLessThan(1e-6)
  })

  it('guesses inches for a unitless file when the bore matches in inches', () => {
    const p = preview(dxfText(footEntities(design, inches), { units: null }), design)
    expect(p.units).toBe('in')
    expect(p.unitsGuessed).toBe(true)
  })

  it('warns when the declared unit gives an unlikely size', () => {
    expect(preview(dxfText(footEntities(design, inches), { units: 4 }), design).unitsWarning).toMatch(/drawn in inches\?/)
  })
})

describe('messy drawings', () => {
  const square = (gap = 0): string[][] => [
    line({ x: -20, y: -20 }, { x: 20, y: -20 }),
    line({ x: 20, y: -20 }, { x: 20, y: 20 }),
    line({ x: 20, y: 20 }, { x: -20, y: 20 }),
    line({ x: -20, y: 20 }, { x: -20, y: -20 + gap }),
  ]

  it('closes small gaps, and offers to close larger ones', () => {
    expect(preview(dxfText(square(0.01))).notes.join(' ')).toMatch(/Closed 1 small gap/)
    const open = preview(dxfText(square(0.3)))
    expect(open.error).toMatch(/no closed outline: 2 ends/)
    expect(open.openEnds).toHaveLength(2)
    expect(open.suggestedGap).toBeGreaterThanOrEqual(0.3)
    expect(preview(dxfText(square(0.3)), base, { gap: open.suggestedGap! }).error).toBeNull()
  })

  it('drops duplicates, loose lines and lines that split the outline', () => {
    const extra = [...square(), line({ x: -20, y: -20 }, { x: 20, y: 20 }), line({ x: 20, y: 20 }, { x: 40, y: 40 }), ...square()]
    const notes = preview(dxfText(extra)).notes.join(' ')
    expect(notes).toMatch(/Removed 4 duplicate/)
    expect(notes).toMatch(/Dropped 1 line inside an outline/)
    expect(notes).toMatch(/Ignored 1 loose line/)
  })

  it('smooths faceted curves into a foot that rolls instead of rocking', () => {
    const arcFoot = presetDesigns[0].design
    const outline = outlineOf(arcFoot)
    // 64 facets per curve: the facets themselves stray about 0.01 mm from the true curve
    const pts: Vec2[] = outline.flatMap((s) => {
      const n = s.kind === 'line' ? 2 : 64
      return Array.from({ length: n }, (_, k) => pointAt(s, k / n))
    })
    const holes = footEntities(arcFoot).slice(arcFoot.foot.outline.edges.length)
    const text = dxfText([lwpolyline(pts, true), ...holes])
    const raw = preview(text, arcFoot, { smooth: false })
    expect(raw.faceted?.runs).toBeGreaterThan(0)
    expect(analyzeDesign(raw.design!).issues.map((i) => i.code)).toContain('stance-corner')
    const smooth = preview(text, arcFoot)
    expect(smooth.anchors).toBeLessThan(raw.anchors / 4)
    expect(hausdorff(outlineOf(smooth.design), outline)).toBeLessThan(0.03)
    const codes = analyzeDesign(smooth.design!).issues.map((i) => i.code)
    expect(codes).not.toContain('stance-corner')
    expect(codes).not.toContain('stance-jump')
  })

  it('offers to make an almost symmetric foot exactly symmetric', () => {
    const arcFoot = presetDesigns[0].design
    const o = arcFoot.foot.outline
    const right = o.nodes[1]
    const nudged = withOutline(moveNode(o, right.id, { x: right.p.x + 0.05, y: right.p.y }), false)
    const p = preview(dxfText(footEntities(nudged)), nudged)
    expect(p.symmetric).toBe(false)
    expect(p.nearSymmetry).toBeGreaterThan(0.005)
    expect(p.nearSymmetry).toBeLessThan(0.2)
    expect(preview(dxfText(footEntities(nudged)), nudged, { makeSymmetric: true }).design?.foot.mirror).toBe(true)
  })

  it('recognises a bore drawn as a fine polygon', () => {
    const arcFoot = presetDesigns[0].design
    const r = boreRadius(arcFoot)
    const polygon = Array.from({ length: 72 }, (_, k) => ({ x: r * Math.cos((k * Math.PI) / 36), y: r * Math.sin((k * Math.PI) / 36) }))
    const p = preview(dxfText([...footEntities(arcFoot).slice(0, -1), lwpolyline(polygon, true)]), arcFoot)
    expect(p.slotFixed).toBe(true)
    expect(p.mechanism).toBeNull()
  })
})

describe('finding loops', () => {
  const teardrop = presetDesigns[2].design
  const outline = outlineOf(teardrop)
  const ring = (r: number): ArcSegment[] => [
    { kind: 'arc', center: { x: 0, y: 0 }, radius: r, startAngle: 0, sweep: Math.PI },
    { kind: 'arc', center: { x: 0, y: 0 }, radius: r, startAngle: Math.PI, sweep: Math.PI },
  ]

  it('rebuilds the same loops from shuffled, partly reversed entities', () => {
    const all = [...outline, ...slotOf(teardrop), ...ring(10)]
    const shuffled = all
      .map((s, i) => ({ s, key: (i * 7919) % all.length }))
      .sort((a, b) => a.key - b.key)
      .map(({ s }, i) => (i % 2 === 0 ? reverseSegment(s) : s))
    const found = findLoops(shuffled)
    expect(found.loops.map((l) => l.depth)).toEqual([0, 1, 1])
    expect(hausdorff(found.loops[0].segments, outline)).toBeLessThan(1e-7)
  })

  it('nests parts inside holes with the even-odd rule', () => {
    expect(findLoops([...ring(30), ...ring(20), ...ring(10)]).loops.map((l) => l.depth)).toEqual([0, 1, 2])
  })

  it('merges overlapping collinear lines', () => {
    const segs: Segment[] = [
      { kind: 'line', p0: { x: 0, y: 0 }, p1: { x: 6, y: 0 } },
      { kind: 'line', p0: { x: 4, y: 0 }, p1: { x: 10, y: 0 } },
      { kind: 'line', p0: { x: 10, y: 0 }, p1: { x: 10, y: 10 } },
      { kind: 'line', p0: { x: 10, y: 10 }, p1: { x: 0, y: 10 } },
      { kind: 'line', p0: { x: 0, y: 10 }, p1: { x: 0, y: 0 } },
    ]
    const found = findLoops(segs)
    expect(found.merged).toBe(1)
    expect(found.loops).toHaveLength(1)
    expect(found.loops[0].area).toBeCloseTo(100, 9)
  })

  it('merges overlapping arcs of one circle, including across 0°', () => {
    const c = { x: 5, y: -2 }
    const arcs: ArcSegment[] = [
      { kind: 'arc', center: c, radius: 8, startAngle: degToRad(-30), sweep: degToRad(200) },
      { kind: 'arc', center: c, radius: 8, startAngle: degToRad(150), sweep: degToRad(200) },
    ]
    const found = findLoops(arcs)
    expect(found.merged).toBeGreaterThan(0)
    expect(found.loops).toHaveLength(1)
    expect(found.loops[0].area).toBeCloseTo(Math.PI * 64, 6)
  })
})
