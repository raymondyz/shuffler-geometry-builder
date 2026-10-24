import { arcFromBulge } from '../../curves/outline'
import type { Segment } from '../../curves/segment'
import { degToRad, TAU, wrapTau } from '../../math/angle'
import { angleOf, distance, length, perp, scale, type Vec2 } from '../../math/vec2'
import { ImportError } from '../errors'
import {
  applyAffine,
  arcPieceCount,
  compose,
  IDENTITY,
  isFiniteSegment,
  rotation,
  scaling,
  transformSegment,
  translation,
  unitArcCubics,
  type Affine,
} from '../segments'
import { splineSegments } from './nurbs'
import { numberOf, valueOf, type DxfDrawing, type DxfRecord } from './reader'

// DXF entities → flat segments in drawing units (SPEC §14.3).

/** Fitting tolerance for curves that have no exact form, in drawing units scaled to mm at 1:1 */
const FIT_TOL = 1e-3
const MAX_BLOCK_DEPTH = 16
const MAX_SEGMENTS = 400_000

export interface DrawingSegment {
  seg: Segment
  layer: string
  /** On a layer that is off or frozen */
  hidden: boolean
  /** In paper space (sheet borders, title blocks) */
  paper: boolean
}

export interface Interpretation {
  segments: DrawingSegment[]
  /** Entity types that were skipped, with counts */
  ignored: Map<string, number>
  /** Curves fitted rather than converted exactly */
  approximated: number
  /** Entities tilted out of the XY plane */
  tilted: number
  /** Entities with invalid or non-finite data */
  invalid: number
  missingBlocks: string[]
  /** Block references nested too deeply or in a cycle */
  deepBlocks: number
  /** Range of Z heights seen */
  zMin: number
  zMax: number
}

interface Context {
  out: Interpretation
  drawing: DxfDrawing
  missing: Set<string>
}

interface Placement {
  m: Affine
  layer: string
  paper: boolean
  depth: number
  stack: string[]
}

/**
 * The 2D part of an entity's object coordinate system. Only extrusions along ±Z keep an entity flat
 * in XY; (0, 0, −1) mirrors x (the DXF arbitrary-axis rule). Null for a tilted extrusion.
 */
function ocsOf(r: DxfRecord): Affine | null {
  const nx = numberOf(r, 210, 0)
  const ny = numberOf(r, 220, 0)
  const nz = numberOf(r, 230, 1)
  const len = Math.hypot(nx, ny, nz)
  if (!(len > 0) || Math.abs(nx) > 1e-9 * len || Math.abs(ny) > 1e-9 * len) return null
  return nz > 0 ? IDENTITY : scaling(-1, 1)
}

const point = (r: DxfRecord, xCode: number, yCode: number): Vec2 => ({ x: numberOf(r, xCode), y: numberOf(r, yCode) })

function noteZ(ctx: Context, z: number) {
  if (!Number.isFinite(z)) return
  ctx.out.zMin = Math.min(ctx.out.zMin, z)
  ctx.out.zMax = Math.max(ctx.out.zMax, z)
}

/** Two half arcs: an outline anchor needs a start and an end. */
function circleArcs(center: Vec2, radius: number, start = 0, sweep = TAU): Segment[] {
  return [
    { kind: 'arc', center, radius, startAngle: start, sweep: sweep / 2 },
    { kind: 'arc', center, radius, startAngle: start + sweep / 2, sweep: sweep / 2 },
  ]
}

function arcSegments(r: DxfRecord, full: boolean): Segment[] {
  const center = point(r, 10, 20)
  const radius = numberOf(r, 40)
  if (full) return circleArcs(center, radius)
  const start = degToRad(numberOf(r, 50))
  // DXF arcs run counter-clockwise from start to end; equal angles mean a full circle
  const sweep = wrapTau(degToRad(numberOf(r, 51)) - start) || TAU
  if (sweep > TAU - 1e-9) return circleArcs(center, radius, start)
  return [{ kind: 'arc', center, radius, startAngle: start, sweep }]
}

interface Vertex {
  p: Vec2
  bulge: number
}

function chainSegments(vertices: Vertex[], closed: boolean): Segment[] {
  const out: Segment[] = []
  const count = closed ? vertices.length : vertices.length - 1
  for (let i = 0; i < count; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    if (!(distance(a.p, b.p) > 1e-12)) continue
    out.push(Math.abs(a.bulge) > 1e-12 ? arcFromBulge(a.p, b.p, a.bulge) : { kind: 'line', p0: a.p, p1: b.p })
  }
  return out
}

/** LWPOLYLINE vertices come as repeated 10/20 pairs, each optionally followed by its bulge (42). */
function lwpolylineVertices(r: DxfRecord): Vertex[] {
  const vertices: Vertex[] = []
  for (const [code, value] of r.codes) {
    if (code === 10) vertices.push({ p: { x: Number(value), y: NaN }, bulge: 0 })
    else if (code === 20 && vertices.length > 0) vertices[vertices.length - 1].p.y = Number(value)
    else if (code === 42 && vertices.length > 0) vertices[vertices.length - 1].bulge = Number(value)
  }
  return vertices
}

function ellipseSegments(r: DxfRecord, ctx: Context): Segment[] {
  const center = point(r, 10, 20)
  const major = point(r, 11, 21)
  const ratio = numberOf(r, 40, 1)
  const t0 = numberOf(r, 41, 0)
  const sweep = wrapTau(numberOf(r, 42, TAU) - t0) || TAU
  // The parameter runs counter-clockwise about the extrusion, so a −Z extrusion reverses it
  const side = numberOf(r, 230, 1) < 0 ? -1 : 1
  const minor = scale(perp(major), ratio * side)
  const a = length(major)
  if (Math.abs(ratio - 1) < 1e-9) {
    const start = angleOf(major) + side * t0
    if (sweep > TAU - 1e-9) return circleArcs(center, a, start)
    return [{ kind: 'arc', center, radius: a, startAngle: start, sweep: side * sweep }]
  }
  ctx.out.approximated++
  const m: Affine = { a: major.x, b: minor.x, c: major.y, d: minor.y, tx: center.x, ty: center.y }
  return unitArcCubics(t0, sweep, arcPieceCount(sweep, a, FIT_TOL), m)
}

function splineOf(r: DxfRecord, ctx: Context): Segment[] | null {
  const points: Vec2[] = []
  const fitPoints: Vec2[] = []
  const knots: number[] = []
  const weights: number[] = []
  for (const [code, value] of r.codes) {
    const v = Number(value)
    if (code === 10) points.push({ x: v, y: NaN })
    else if (code === 20 && points.length > 0) points[points.length - 1].y = v
    else if (code === 11) fitPoints.push({ x: v, y: NaN })
    else if (code === 21 && fitPoints.length > 0) fitPoints[fitPoints.length - 1].y = v
    else if (code === 40) knots.push(v)
    else if (code === 41) weights.push(v)
  }
  const tangent = (x: number, y: number) => (valueOf(r, x) !== undefined ? point(r, x, y) : null)
  const result = splineSegments(
    { degree: numberOf(r, 71, 3), knots, points, weights, fitPoints, startTangent: tangent(12, 22), endTangent: tangent(13, 23) },
    FIT_TOL,
  )
  if (!result) return null
  if (result.approximated) ctx.out.approximated++
  return result.segments
}

function add(ctx: Context, segments: Segment[], m: Affine, at: Placement) {
  const layer = ctx.drawing.layers.get(at.layer.toUpperCase())
  for (const s of segments) {
    if (!isFiniteSegment(s)) {
      ctx.out.invalid++
      return
    }
  }
  for (const s of segments) {
    for (const seg of transformSegment(s, m, FIT_TOL)) {
      ctx.out.segments.push({ seg, layer: at.layer, hidden: layer?.hidden ?? false, paper: at.paper })
    }
  }
  if (ctx.out.segments.length > MAX_SEGMENTS) throw new ImportError('This drawing is too large to import. Export just the foot.')
}

function insert(r: DxfRecord, ctx: Context, at: Placement, ocs: Affine) {
  const name = valueOf(r, 2) ?? ''
  const block = ctx.drawing.blocks.get(name)
  if (!block) {
    ctx.missing.add(name)
    return
  }
  if (at.depth >= MAX_BLOCK_DEPTH || at.stack.includes(name)) {
    ctx.out.deepBlocks++
    return
  }
  const sx = numberOf(r, 41, 1)
  const sy = numberOf(r, 42, 1)
  const rot = degToRad(numberOf(r, 50, 0))
  const cols = Math.max(1, Math.min(100, Math.round(numberOf(r, 70, 1)) || 1))
  const rows = Math.max(1, Math.min(100, Math.round(numberOf(r, 71, 1)) || 1))
  const colStep = numberOf(r, 44, 0)
  const rowStep = numberOf(r, 45, 0)
  const ins = point(r, 10, 20)
  if (![sx, sy, rot, colStep, rowStep, ins.x, ins.y].every(Number.isFinite) || sx === 0 || sy === 0) {
    ctx.out.invalid++
    return
  }
  const local = compose(rotation(rot), compose(scaling(sx, sy), translation({ x: -block.base.x, y: -block.base.y })))
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const offset = applyAffine(rotation(rot), { x: col * colStep, y: row * rowStep })
      const m = compose(at.m, compose(ocs, compose(translation({ x: ins.x + offset.x, y: ins.y + offset.y }), local)))
      const child: Placement = { m, layer: at.layer, paper: at.paper, depth: at.depth + 1, stack: [...at.stack, name] }
      for (const e of block.entities) entity(e, ctx, child)
    }
  }
}

const HANDLED = new Set(['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE', 'SPLINE', 'ELLIPSE', 'INSERT'])

function entity(r: DxfRecord, ctx: Context, parent: Placement) {
  if (numberOf(r, 60, 0) === 1) return
  if (!HANDLED.has(r.type)) {
    ctx.out.ignored.set(r.type, (ctx.out.ignored.get(r.type) ?? 0) + 1)
    return
  }
  // Entities on layer 0 inside a block take the layer of the block reference
  const own = valueOf(r, 8) ?? '0'
  const at: Placement = {
    ...parent,
    layer: parent.depth > 0 && own === '0' ? parent.layer : own,
    paper: parent.depth > 0 ? parent.paper : numberOf(r, 67, 0) === 1,
  }
  switch (r.type) {
    case 'LINE':
      noteZ(ctx, numberOf(r, 30))
      noteZ(ctx, numberOf(r, 31))
      add(ctx, [{ kind: 'line', p0: point(r, 10, 20), p1: point(r, 11, 21) }], at.m, at)
      return
    case 'SPLINE': {
      const segments = splineOf(r, ctx)
      if (segments) add(ctx, segments, at.m, at)
      else ctx.out.invalid++
      return
    }
  }
  const ocs = ocsOf(r)
  if (!ocs) {
    ctx.out.tilted++
    return
  }
  const m = compose(at.m, ocs)
  switch (r.type) {
    case 'ARC':
    case 'CIRCLE':
      noteZ(ctx, numberOf(r, 30))
      add(ctx, arcSegments(r, r.type === 'CIRCLE'), m, at)
      return
    case 'ELLIPSE':
      // Points are in world coordinates; the extrusion only sets the direction of the parameter
      noteZ(ctx, numberOf(r, 30))
      add(ctx, ellipseSegments(r, ctx), at.m, at)
      return
    case 'LWPOLYLINE':
      noteZ(ctx, numberOf(r, 38))
      add(ctx, chainSegments(lwpolylineVertices(r), (numberOf(r, 70) & 1) !== 0), m, at)
      return
    case 'POLYLINE': {
      const flags = numberOf(r, 70)
      // 3D polylines and meshes have no place in a flat profile
      if (flags & (8 | 16 | 64)) {
        ctx.out.ignored.set('3D POLYLINE', (ctx.out.ignored.get('3D POLYLINE') ?? 0) + 1)
        return
      }
      noteZ(ctx, numberOf(r, 30))
      const vertices = (r.vertices ?? [])
        .filter((v) => (numberOf(v, 70) & 16) === 0)
        .map((v) => ({ p: point(v, 10, 20), bulge: numberOf(v, 42) }))
      add(ctx, chainSegments(vertices, (flags & 1) !== 0), m, at)
      return
    }
    case 'INSERT':
      insert(r, ctx, at, ocs)
      return
  }
}

/** Every entity of model and paper space as flat segments in drawing units, plus what was skipped. */
export function interpretDrawing(drawing: DxfDrawing): Interpretation {
  const out: Interpretation = {
    segments: [],
    ignored: new Map(),
    approximated: 0,
    tilted: 0,
    invalid: 0,
    missingBlocks: [],
    deepBlocks: 0,
    zMin: Infinity,
    zMax: -Infinity,
  }
  const ctx: Context = { out, drawing, missing: new Set() }
  const root: Placement = { m: IDENTITY, layer: '0', paper: false, depth: 0, stack: [] }
  for (const r of drawing.entities) entity(r, ctx, root)
  out.missingBlocks = [...ctx.missing]
  return out
}
