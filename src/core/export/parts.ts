import type { Analysis } from '../analysis/analyze'
import { flatten } from '../curves/outline'
import type { Segment } from '../curves/segment'
import { boreRadius, camRadius, shaftClearRadius, slotRadius } from '../design/hardware'
import { degToRad, radToDeg, TAU } from '../math/angle'
import { add, fromAngle, type Vec2 } from '../math/vec2'
import { piece2DToBezier } from '../spline/curve'

export type PartLayer = 'foot' | 'cam' | 'frame' | 'reference'

export interface Circle {
  center: Vec2
  radius: number
}

/** One manufacturable (or reference) part, in its own frame, positioned at `offset` on the sheet. */
export interface Part {
  label: string
  layer: PartLayer
  /** Chains of segments (outlines and cut-outs) */
  paths: Segment[][]
  circles: Circle[]
  offset: Vec2
}

function hexBore(acrossFlats: number, rotation: number): Segment[] {
  const r = acrossFlats / Math.sqrt(3)
  const pts = Array.from({ length: 6 }, (_, i) => fromAngle(rotation + (i * Math.PI) / 3, r))
  return pts.map((p, i) => ({ kind: 'line', p0: p, p1: pts[(i + 1) % 6] }))
}

/**
 * Distinct cam variants. On a hex shaft a cam rotated by a multiple of 60° is the same part,
 * so feet whose phases agree modulo 60° share a design (SPEC §14).
 */
export function camVariants(feet: number, shaft: 'hex' | 'round'): { phase: number; feet: number[] }[] {
  if (shaft === 'round') return [{ phase: 0, feet: Array.from({ length: feet }, (_, k) => k) }]
  const variants: { phase: number; feet: number[] }[] = []
  for (let k = 0; k < feet; k++) {
    const deg = radToDeg((k * TAU) / feet) % 60
    const phase = Math.round(deg * 1e6) / 1e6
    const existing = variants.find((v) => Math.abs(v.phase - phase) < 1e-6 || Math.abs(Math.abs(v.phase - phase) - 60) < 1e-6)
    if (existing) existing.feet.push(k)
    else variants.push({ phase, feet: [k] })
  }
  return variants
}

function bounds(part: Part): { min: Vec2; max: Vec2 } {
  const pts: Vec2[] = part.paths.flatMap((p) => flatten(p, 16))
  for (const c of part.circles) pts.push(add(c.center, { x: -c.radius, y: -c.radius }), add(c.center, { x: c.radius, y: c.radius }))
  const min = { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) }
  const max = { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) }
  return { min, max }
}

export interface PartOptions {
  includeReference: boolean
}

/** Every part of the module laid out left to right, bottoms aligned at y = 0, 15 mm apart. */
export function buildParts(analysis: Analysis, options: PartOptions): Part[] {
  const { design, outline, mechanism, kinematics } = analysis
  const h = design.hardware
  const feet = design.feet.count
  const parts: Part[] = []

  if (outline) {
    parts.push({
      label: `Foot (×${feet})`,
      layer: 'foot',
      paths: [outline.segments, mechanism.constraint.slotOutline(slotRadius(h))],
      circles: [{ center: { x: 0, y: 0 }, radius: boreRadius(design) }],
      offset: { x: 0, y: 0 },
    })
  }

  const L = design.drive.L
  const camR = camRadius(design)
  const variants = camVariants(feet, h.shaft.kind)
  variants.forEach((v, i) => {
    const name = variants.length > 1 ? `Cam ${String.fromCharCode(65 + i)}` : 'Cam'
    const feetLabel = v.feet.map((k) => k + 1).join(', ')
    const center = fromAngle(degToRad(v.phase), L)
    const bore: Part['paths'] = h.shaft.kind === 'hex' ? [hexBore(h.shaft.size + 2 * h.clearance, Math.PI / 6)] : []
    const holes: Circle[] = h.shaft.kind === 'round' ? [{ center: { x: 0, y: 0 }, radius: shaftClearRadius(h) }] : []
    parts.push({
      label: `${name} (feet ${feetLabel})`,
      layer: 'cam',
      paths: bore,
      circles: [{ center, radius: camR }, ...holes],
      offset: { x: 0, y: 0 },
    })
  })

  parts.push({
    label: 'Frame holes (P0, Ps)',
    layer: 'frame',
    paths: [],
    circles: [
      { center: { x: 0, y: 0 }, radius: shaftClearRadius(h) },
      { center: mechanism.constraint.pin, radius: h.pinDiameter / 2 },
    ],
    offset: { x: 0, y: 0 },
  })

  if (options.includeReference && kinematics) {
    const beziers = kinematics.curves.trace.pieces.map(piece2DToBezier)
    parts.push({
      label: 'Contact path (reference)',
      layer: 'reference',
      paths: [beziers.map((b) => ({ kind: 'cubic', p0: b.p0, p1: b.p1, p2: b.p2, p3: b.p3 }))],
      circles: [{ center: { x: 0, y: 0 }, radius: 0.5 }],
      offset: { x: 0, y: 0 },
    })
  }

  let x = 0
  return parts.map((part) => {
    const b = bounds(part)
    const offset = { x: x - b.min.x, y: -b.min.y }
    x += Math.max(b.max.x - b.min.x, labelWidth(part.label)) + 15
    return { ...part, offset }
  })
}

/** Approximate width of a part label on the sheet (mm), so labels never overlap. */
export const LABEL_HEIGHT = 4
export const labelWidth = (label: string): number => label.length * LABEL_HEIGHT * 0.56

/** Bounds of a placed part in sheet coordinates. */
export function partBounds(part: Part): { min: Vec2; max: Vec2 } {
  const b = bounds(part)
  return { min: add(b.min, part.offset), max: add(b.max, part.offset) }
}

export function sheetBounds(parts: Part[]): { min: Vec2; max: Vec2 } {
  const all = parts.map((p) => {
    const b = partBounds(p)
    return { min: b.min, max: { x: Math.max(b.max.x, b.min.x + labelWidth(p.label)), y: b.max.y } }
  })
  return {
    min: { x: Math.min(...all.map((b) => b.min.x)), y: Math.min(...all.map((b) => b.min.y)) },
    max: { x: Math.max(...all.map((b) => b.max.x)), y: Math.max(...all.map((b) => b.max.y)) },
  }
}
