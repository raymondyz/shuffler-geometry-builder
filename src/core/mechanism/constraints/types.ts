import type { Segment } from '../../curves/segment'
import type { Vec2 } from '../../math/vec2'
import type { Drive } from '../drive'

/** Foot tilt α (relative to neutral, CCW positive) and its first two derivatives with respect to φ. */
export interface TiltState {
  alpha: number
  d1: number
  d2: number
}

export interface ConstraintIssue {
  level: 'error' | 'warning'
  code: string
  message: string
}

/**
 * Sets the foot tilt as a function of cam angle. New slot geometries implement this interface
 * and register a factory in ./registry.
 */
export interface TiltConstraint {
  kind: string
  /** Stationary shaft centre in the body frame */
  pin: Vec2
  tilt(phi: number): TiltState
  /** Cam angles in [0, 2π) where α' = 0, sorted; α is monotone between them */
  tiltExtrema(): number[]
  /** Pin-centre path in the foot frame (an open chain the pin slides back and forth along) */
  pinLocus(): Segment[]
  /** Slot cut-out in the foot frame for a pin of the given radius (pin radius + clearance) */
  slotOutline(radius: number): Segment[]
  issues(): ConstraintIssue[]
}

export interface ConstraintFactory<Spec> {
  kind: string
  label: string
  description: string
  create(spec: Spec, drive: Drive): TiltConstraint
}
