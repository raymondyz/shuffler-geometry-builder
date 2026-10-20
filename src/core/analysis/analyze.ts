import type { Segment } from '../curves/segment'
import { hullFragments } from '../curves/supportMap'
import { blockingIssues, hardwareIssues, motionIssues, type Issue } from '../design/validate'
import type { Design } from '../design/schema'
import { TAU } from '../math/angle'
import { createConstraint, type ConstraintSpec } from '../mechanism/constraints/registry'
import type { TiltConstraint } from '../mechanism/constraints/types'
import { eccentricDrive, type Drive } from '../mechanism/drive'
import type { Curve2D } from '../spline/curve'
import { lazy, memoizeLast } from '../util/lazy'
import { computeEnvelope, lowestFoot, type Envelope } from './envelope'
import { findFootEvents, type FootEvent } from './events'
import { createFootModel, type FootModel } from './foot'
import { fitFootCurves, fitTraceRange, type FootCurves } from './footCurves'
import { computeMetrics, stanceIntervals, type Metrics, type StanceInterval } from './metrics'
import { prepareOutline, type PreparedOutline } from './prepare'

export interface Mechanism {
  drive: Drive
  constraint: TiltConstraint
}

/** Results of the kinematic analysis; only present when the mechanism is valid. */
export interface Kinematics {
  feet: number
  period: number
  model: FootModel
  events: FootEvent[]
  curves: FootCurves
  envelope: Envelope
  /** Foot 0's stance intervals over one revolution */
  stance: StanceInterval[]
  metrics: Metrics
  /** Foot-frame ψ ranges swept by the contact over the whole cycle and during stance */
  bands: { cycle: [number, number]; stance: [number, number] }
  envelopeAt(phi: number): { y: number; foot: number }
  /** Lazily computed, cached extras for views */
  stanceTrace: () => Curve2D[]
  hull: () => Segment[]
  cycleBand: () => Segment[]
  stanceBand: () => Segment[]
}

export interface Analysis {
  design: Design
  outline: PreparedOutline | null
  mechanism: Mechanism
  kinematics: Kinematics | null
  issues: Issue[]
}

function buildMechanism(drive: Design['drive'], constraint: ConstraintSpec): Mechanism {
  const d = eccentricDrive(drive.L)
  return { drive: d, constraint: createConstraint(constraint, d) }
}

function computeKinematics(outline: PreparedOutline, mechanism: Mechanism, feet: number): Kinematics {
  const model = createFootModel(mechanism.drive, mechanism.constraint, outline.supportMap)
  const events = findFootEvents(model)
  const curves = fitFootCurves(model, events)
  const envelope = computeEnvelope(model, events, feet)
  const stance = stanceIntervals(envelope)
  const metrics = computeMetrics(model, events, envelope, feet, stance)
  const toPsi = ([lo, hi]: [number, number]): [number, number] => [-Math.PI / 2 - hi, -Math.PI / 2 - lo]
  const bands = { cycle: toPsi(metrics.tiltRange), stance: toPsi(metrics.stanceTiltRange) }
  const map = outline.supportMap
  return {
    feet,
    period: TAU / feet,
    model,
    events,
    curves,
    envelope,
    stance,
    metrics,
    bands,
    envelopeAt: (phi) => lowestFoot(model, feet, phi),
    stanceTrace: lazy(() => stance.map((iv) => fitTraceRange(model, events, iv.phi0, iv.phi1))),
    hull: lazy(() => hullFragments(map, outline.ccw, -Math.PI, Math.PI)),
    cycleBand: lazy(() => hullFragments(map, outline.ccw, bands.cycle[0], bands.cycle[1])),
    stanceBand: lazy(() => hullFragments(map, outline.ccw, bands.stance[0], bands.stance[1])),
  }
}

/**
 * Creates a memoised analysis pipeline (SPEC §12.4). Each stage only reruns when its inputs change
 * identity: editing the outline skips the mechanism stage, changing hardware skips the kinematics.
 */
export function createAnalyzer(): (design: Design) => Analysis {
  const prepare = memoizeLast(prepareOutline)
  const mechanismOf = memoizeLast(buildMechanism)
  const kinematicsOf = memoizeLast(computeKinematics)
  return memoizeLast((design: Design): Analysis => {
    const outline = prepare(design.foot.outline)
    const mechanism = mechanismOf(design.drive, design.constraint)
    const blocking = blockingIssues(design, outline, mechanism.constraint)
    const hardware = hardwareIssues(design, outline, mechanism.constraint)
    if (blocking.length > 0 || !outline) {
      return { design, outline, mechanism, kinematics: null, issues: [...blocking, ...hardware] }
    }
    const kinematics = kinematicsOf(outline, mechanism, design.feet.count)
    return { design, outline, mechanism, kinematics, issues: [...hardware, ...motionIssues(kinematics.metrics)] }
  })
}

export const analyzeDesign = (design: Design): Analysis => createAnalyzer()(design)
