import { distanceToPolyline, pointInPolyline, polylineSelfIntersects, segmentDistanceToPolyline } from '../curves/outline'
import { pointAt } from '../curves/segment'
import { length } from '../math/vec2'
import type { PreparedOutline } from '../analysis/prepare'
import type { Metrics } from '../analysis/metrics'
import type { TiltConstraint } from '../mechanism/constraints/types'
import { boreRadius, slotRadius } from './hardware'
import { MAX_FEET, MIN_FEET, type Design } from './schema'

export type IssueTarget = 'feet' | 'drive' | 'pin' | 'hardware' | 'outline'

export interface Issue {
  level: 'error' | 'warning'
  code: string
  message: string
  target?: IssueTarget
}

const fmt = (mm: number) => `${mm.toFixed(2)} mm`

/** Problems that make the mechanism impossible to analyse. */
export function blockingIssues(design: Design, outline: PreparedOutline | null, constraint: TiltConstraint): Issue[] {
  const issues: Issue[] = []
  const n = design.feet.count
  if (!Number.isInteger(n) || n < MIN_FEET || n > MAX_FEET) {
    issues.push({ level: 'error', code: 'feet-count', message: `Number of feet must be a whole number from ${MIN_FEET} to ${MAX_FEET}.`, target: 'feet' })
  }
  if (!(design.drive.L > 0)) {
    issues.push({ level: 'error', code: 'eccentricity', message: 'Eccentricity L must be greater than zero.', target: 'drive' })
  }
  for (const c of constraint.issues()) issues.push({ ...c, target: 'pin' })
  if (!outline) {
    issues.push({ level: 'error', code: 'outline-degenerate', message: 'The foot outline needs at least two anchors and a non-zero area.', target: 'outline' })
  }
  return issues
}

/**
 * Manufacturability checks: walls, bores and slot fit. The cam disc needs no check because it is
 * sized automatically around the shaft (see ./hardware).
 */
export function hardwareIssues(design: Design, outline: PreparedOutline | null, constraint: TiltConstraint): Issue[] {
  const issues: Issue[] = []
  const h = design.hardware
  const pinDist = length(constraint.pin)
  const slotBoreGap = pinDist - design.drive.L - slotRadius(h) - boreRadius(design)
  if (slotBoreGap < h.minWall) {
    issues.push({
      level: 'error',
      code: 'slot-bore',
      message: `Material between the slot and the cam bore is ${fmt(slotBoreGap)} (minimum ${fmt(h.minWall)}). Move the stationary shaft further away.`,
      target: 'pin',
    })
  }
  if (!outline) return issues

  const poly = outline.polyline()
  if (polylineSelfIntersects(poly)) {
    issues.push({ level: 'error', code: 'outline-self-intersects', message: 'The foot outline crosses itself.', target: 'outline' })
  }
  const origin = { x: 0, y: 0 }
  const boreWall = distanceToPolyline(origin, poly) - boreRadius(design)
  if (!pointInPolyline(origin, poly) || boreWall < h.minWall) {
    issues.push({
      level: 'error',
      code: 'bore-wall',
      message: pointInPolyline(origin, poly)
        ? `Foot wall around the cam bore is ${fmt(boreWall)} (minimum ${fmt(h.minWall)}).`
        : 'The cam bore centre (P1) must be inside the foot outline.',
      target: 'outline',
    })
  }
  for (const seg of constraint.pinLocus()) {
    const a = pointAt(seg, 0)
    const b = pointAt(seg, 1)
    const wall = segmentDistanceToPolyline(a, b, poly) - slotRadius(h)
    if (!pointInPolyline(a, poly) || !pointInPolyline(b, poly) || wall < h.minWall) {
      issues.push({
        level: 'error',
        code: 'slot-wall',
        message: `Foot wall around the slot is ${fmt(Math.max(0, wall))} (minimum ${fmt(h.minWall)}). Enlarge the outline around the slot.`,
        target: 'outline',
      })
      break
    }
  }
  return issues
}

/** Stance-quality warnings derived from the analysis (SPEC §15). */
export function motionIssues(m: Metrics): Issue[] {
  const issues: Issue[] = []
  if (m.stanceJumps > 0) {
    issues.push({
      level: 'warning',
      code: 'stance-jump',
      message: 'The contact point jumps across a concave or flat region during stance (the foot rocks onto another part of the outline).',
      target: 'outline',
    })
  }
  if (m.stanceCorners > 0) {
    issues.push({ level: 'warning', code: 'stance-corner', message: 'A sharp corner of the foot touches the ground during stance.', target: 'outline' })
  }
  if (m.doubleSupport > 0.01 && m.handoffSlip > 0.01) {
    issues.push({ level: 'warning', code: 'double-support-slip', message: 'Two feet share the load while moving at different speeds, so one will scrub.', target: 'outline' })
  }
  return issues
}
