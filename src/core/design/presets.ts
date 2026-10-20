import { degToRad } from '../math/angle'
import { add, angleOf, distance, fromAngle, length, normalize, perp, scale, sub, type Vec2 } from '../math/vec2'
import type { Outline, OutlineEdge, OutlineNode } from '../curves/outline'
import type { Design } from './schema'

/** Geometry a preset must leave room for (all in the foot frame). */
export interface PresetContext {
  /** Pin path along the centreline: from pinDistance − L to pinDistance + L */
  pinDistance: number
  L: number
  slotRadius: number
  minWall: number
}

export function presetContext(design: Design): PresetContext {
  const { hardware } = design
  return {
    pinDistance: length(design.constraint.pin),
    L: design.drive.L,
    slotRadius: hardware.pinDiameter / 2 + hardware.clearance,
    minWall: hardware.minWall,
  }
}

let nextId = 0
export const newNodeId = (): string => `n${Date.now().toString(36)}${(nextId++).toString(36)}`

const node = (p: Vec2, hIn: Vec2, hOut: Vec2, mode: OutlineNode['mode'] = 'corner'): OutlineNode => ({
  id: newNodeId(),
  p,
  hIn,
  hOut,
  mode,
})

const cubic = (): OutlineEdge => ({ kind: 'cubic', bulge: 0 })

/**
 * Builds the slot cap and both sides for a given bottom. The cap is an arc around the top end of the
 * slot; its start angle is chosen so the sides stay convex.
 */
function withCap(
  ctx: PresetContext,
  bottomRight: Vec2,
  rightTangent: Vec2,
  bottomLeft: Vec2,
  leftTangent: Vec2,
): { right: OutlineNode; capRight: OutlineNode; capLeft: OutlineNode; left: OutlineNode; cap: OutlineEdge } {
  const capCenter = { x: 0, y: ctx.pinDistance + ctx.L }
  const capRadius = ctx.slotRadius + ctx.minWall + 2
  const provisional = add(capCenter, fromAngle(degToRad(20), capRadius))
  const chordAngle = angleOf(sub(provisional, bottomRight))
  const beta = Math.max(degToRad(20), chordAngle - Math.PI / 2 + degToRad(8))
  const capRight = add(capCenter, fromAngle(beta, capRadius))
  const capLeft = { x: -capRight.x, y: capRight.y }
  const reach = distance(bottomRight, capRight) * 0.35
  const arrive = fromAngle(beta + Math.PI / 2)
  const capSweep = Math.PI - 2 * beta
  return {
    right: node(bottomRight, { x: 0, y: 0 }, scale(normalize(rightTangent), reach)),
    capRight: node(capRight, scale(arrive, -reach), { x: 0, y: 0 }),
    capLeft: node(capLeft, { x: 0, y: 0 }, scale({ x: -arrive.x, y: arrive.y }, -reach)),
    left: node(bottomLeft, scale(normalize(leftTangent), -reach), { x: 0, y: 0 }),
    cap: { kind: 'arc', bulge: Math.tan(capSweep / 4) },
  }
}

/** Bottom is a circular arc centred on P1: constant r over the contact region (SPEC §9). */
export function arcFootOutline(ctx: PresetContext, radius = 50, sweepDeg = 70): Outline {
  const half = degToRad(sweepDeg) / 2
  const right = fromAngle(-Math.PI / 2 + half, radius)
  const left = fromAngle(-Math.PI / 2 - half, radius)
  const parts = withCap(ctx, right, perp(right), left, perp(left))
  return {
    nodes: [parts.left, parts.right, parts.capRight, parts.capLeft],
    edges: [{ kind: 'arc', bulge: Math.tan(half / 2) }, cubic(), parts.cap, cubic()],
  }
}

/** Bottom is a large-radius arc whose lowest point is `depth` below P1: a flatter stance. */
export function flatFootOutline(ctx: PresetContext, depth = 50, bottomRadius = 250, width = 44): Outline {
  const hw = Math.min(width / 2, bottomRadius * 0.95)
  const center = { x: 0, y: -depth + bottomRadius }
  const y = center.y - Math.sqrt(bottomRadius * bottomRadius - hw * hw)
  const right = { x: hw, y }
  const left = { x: -hw, y }
  const parts = withCap(ctx, right, perp(sub(right, center)), left, perp(sub(left, center)))
  const sweep = 2 * Math.asin(hw / bottomRadius)
  return {
    nodes: [parts.left, parts.right, parts.capRight, parts.capLeft],
    edges: [{ kind: 'arc', bulge: Math.tan(sweep / 4) }, cubic(), parts.cap, cubic()],
  }
}

/** All-cubic foot with a single smooth toe node: a starting point for free-form editing. */
export function teardropOutline(ctx: PresetContext, depth = 50, width = 70): Outline {
  const toe = { x: 0, y: -depth }
  const parts = withCap(ctx, toe, { x: 1, y: 0 }, toe, { x: 1, y: 0 })
  const bottom = node(toe, { x: -width / 2, y: 0 }, { x: width / 2, y: 0 }, 'symmetric')
  return {
    nodes: [bottom, parts.capRight, parts.capLeft],
    edges: [cubic(), parts.cap, cubic()],
  }
}

export interface FootPreset {
  id: string
  label: string
  description: string
  create(ctx: PresetContext, footLength: number): Outline
}

export const footPresets: FootPreset[] = [
  {
    id: 'arc',
    label: 'Arc foot',
    description: 'Bottom is an arc centred on the cam: constant r(θ).',
    create: (ctx, footLength) => arcFootOutline(ctx, footLength),
  },
  {
    id: 'flat',
    label: 'Flat-bottom foot',
    description: 'Large-radius bottom for a flatter stance.',
    create: (ctx, footLength) => flatFootOutline(ctx, footLength),
  },
  {
    id: 'teardrop',
    label: 'Teardrop',
    description: 'All-Bézier outline with one smooth toe anchor.',
    create: (ctx, footLength) => teardropOutline(ctx, footLength),
  },
]
