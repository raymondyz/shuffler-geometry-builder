import { TAU, wrapTau } from '../math/angle'
import type { Envelope } from './envelope'
import { lowestFoot } from './envelope'
import type { FootEvent } from './events'
import type { FootModel } from './foot'

export interface StanceInterval {
  phi0: number
  phi1: number
}

/** Geometry-only results per radian of cam (SPEC §8). Lengths in mm, angles in radians. */
export interface Metrics {
  bob: number
  strideStep: number
  strideRev: number
  /** Direction of body travel along x for increasing φ (CCW cam rotation) */
  direction: 1 | -1
  speedMean: number
  speedMin: number
  speedMax: number
  speedRipple: number
  handoffKink: number
  handoffSlip: number
  peakYDD: number
  stanceJumps: number
  stanceCorners: number
  tiltRange: [number, number]
  stanceTiltRange: [number, number]
  footLift: number
  doubleSupport: number
}

/** Time-based values at a given shaft speed. */
export interface OperatingMetrics {
  rpm: number
  omega: number
  /** mm/s */
  groundSpeed: number
  /** mm/s */
  verticalJump: number
  /** mm/s */
  slipSpeed: number
  /** g */
  peakAccel: number
}

const G = 9806.65

export const insideInterval = (phi: number, iv: StanceInterval): boolean => wrapTau(phi - iv.phi0) <= iv.phi1 - iv.phi0

export function stanceIntervals(envelope: Envelope): StanceInterval[] {
  return envelope.spans.map((s) => {
    const phi0 = wrapTau(s.phi0 + s.foot * envelope.period)
    return { phi0, phi1: phi0 + (s.phi1 - s.phi0) }
  })
}

export function computeMetrics(model: FootModel, events: FootEvent[], envelope: Envelope, feet: number, stance: StanceInterval[]): Metrics {
  const direction: 1 | -1 = envelope.stepTravel < 0 ? -1 : 1
  const strideStep = Math.abs(envelope.stepTravel)
  const speedMean = strideStep / envelope.period
  const along = [envelope.minV * direction, envelope.maxV * direction]
  const speedMin = Math.min(...along)
  const speedMax = Math.max(...along)

  const alpha = (phi: number) => model.constraint.tilt(phi).alpha
  const extrema = events.filter((e) => e.kind === 'tiltExtremum').map((e) => e.phi)
  const tiltValues = extrema.length > 0 ? extrema.map(alpha) : Array.from({ length: 360 }, (_, i) => alpha((TAU * i) / 360))
  const stanceTilts: number[] = []
  for (const iv of stance) {
    stanceTilts.push(alpha(iv.phi0), alpha(iv.phi1))
    for (const e of extrema) if (insideInterval(e, iv)) stanceTilts.push(alpha(e))
  }

  const stanceJumps = events.filter((e) => e.kind === 'contactJump' && stance.some((iv) => insideInterval(e.phi, iv))).length
  const stanceCorners = envelope.pieces.filter((p) => model.supportMap.pieces[p.piece].kind === 'point').length

  let footLift = 0
  const liftSamples = 720
  for (let i = 0; i < liftSamples; i++) {
    const phi = (TAU * i) / liftSamples
    footLift = Math.max(footLift, model.sample(phi).y - lowestFoot(model, feet, phi).y)
  }

  return {
    bob: envelope.maxY - envelope.minY,
    strideStep,
    strideRev: strideStep * feet,
    direction,
    speedMean,
    speedMin,
    speedMax,
    speedRipple: speedMean > 0 ? (speedMax - speedMin) / speedMean : 0,
    handoffKink: Math.max(0, ...envelope.handoffs.map((h) => h.kinkY)),
    handoffSlip: Math.max(0, ...envelope.handoffs.map((h) => h.slipX)),
    peakYDD: envelope.peakYDD,
    stanceJumps,
    stanceCorners,
    tiltRange: [Math.min(...tiltValues), Math.max(...tiltValues)],
    stanceTiltRange: [Math.min(...stanceTilts), Math.max(...stanceTilts)],
    footLift,
    doubleSupport: envelope.doubleSupport,
  }
}

export function operatingMetrics(m: Metrics, rpm: number): OperatingMetrics {
  const omega = (rpm * TAU) / 60
  return {
    rpm,
    omega,
    groundSpeed: (m.strideRev * rpm) / 60,
    verticalJump: m.handoffKink * omega,
    slipSpeed: m.handoffSlip * omega,
    peakAccel: (m.peakYDD * omega * omega) / G,
  }
}
