import { wrapPi, wrapTau } from '../../math/angle'
import { angleOf, length, type Vec2 } from '../../math/vec2'
import type { Segment } from '../../curves/segment'
import type { Drive } from '../drive'
import type { ConstraintFactory, ConstraintIssue, TiltConstraint } from './types'

export interface CenterlineSlotSpec {
  kind: 'centerlineSlot'
  pin: Vec2
}

/**
 * The slot runs along the foot centreline (foot-frame +y axis through P1), so the centreline always
 * points from P1 at the pin: α = atan2(−dx, dy) with d = Ps − P1 (SPEC §4.3).
 */
export function createCenterlineSlot(spec: CenterlineSlotSpec, drive: Drive): TiltConstraint {
  const pin = spec.pin
  const pinDist = length(pin)
  const L = drive.L
  // Centre of the tilt range; α is unwrapped around it so it never jumps by 2π
  const alphaRef = wrapPi(angleOf(pin) - Math.PI / 2)

  const tilt = (phi: number) => {
    const p = drive.p1(phi)
    const v = drive.p1d(phi)
    const a = drive.p1dd(phi)
    const dx = pin.x - p.x
    const dy = pin.y - p.y
    const den = dx * dx + dy * dy
    const num = dy * v.x - dx * v.y
    const alpha = alphaRef + wrapPi(Math.atan2(-dx, dy) - alphaRef)
    const d1 = num / den
    const d2 = (dy * a.x - dx * a.y) / den + (2 * num * (dx * v.x + dy * v.y)) / (den * den)
    return { alpha, d1, d2 }
  }

  const tiltExtrema = () => {
    if (!(pinDist > L) || L === 0) return []
    const phiS = angleOf(pin)
    const half = Math.acos(L / pinDist)
    return [wrapTau(phiS - half), wrapTau(phiS + half)].sort((a, b) => a - b)
  }

  const pinLocus = (): Segment[] => [{ kind: 'line', p0: { x: 0, y: pinDist - L }, p1: { x: 0, y: pinDist + L } }]

  const slotOutline = (r: number): Segment[] => {
    const lo = pinDist - L
    const hi = pinDist + L
    return [
      { kind: 'line', p0: { x: r, y: lo }, p1: { x: r, y: hi } },
      { kind: 'arc', center: { x: 0, y: hi }, radius: r, startAngle: 0, sweep: Math.PI },
      { kind: 'line', p0: { x: -r, y: hi }, p1: { x: -r, y: lo } },
      { kind: 'arc', center: { x: 0, y: lo }, radius: r, startAngle: Math.PI, sweep: Math.PI },
    ]
  }

  const issues = (): ConstraintIssue[] => {
    if (pinDist > L) return []
    return [{
      level: 'error',
      code: 'pin-inside-orbit',
      message: 'The stationary shaft must be further from the cam shaft than the eccentricity L.',
    }]
  }

  return { kind: spec.kind, pin, tilt, tiltExtrema, pinLocus, slotOutline, issues }
}

export const centerlineSlotFactory: ConstraintFactory<CenterlineSlotSpec> = {
  kind: 'centerlineSlot',
  label: 'Centreline slot',
  description: 'Straight slot along the foot centreline through the cam bearing centre.',
  create: createCenterlineSlot,
}
