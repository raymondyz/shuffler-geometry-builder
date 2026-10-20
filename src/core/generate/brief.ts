import type { Analysis } from '../analysis/analyze'
import { MAX_FEET, MIN_FEET, type Design } from '../design/schema'

/** A value that is fixed (min = max) or may vary within a range. */
export interface Span {
  min: number
  max: number
}

export type GoalMetric = 'bob' | 'stride' | 'ripple' | 'kink' | 'slip' | 'lift'
export type GoalMode = 'off' | 'limit' | 'goal'
export type Importance = 1 | 2 | 4

/** One metric's role. All values are kept so switching modes doesn't lose them. */
export interface GoalSetting {
  mode: GoalMode
  /** Hard requirement (mode 'limit'): at most for metrics to minimise, at least for metrics to maximise */
  limit: number
  /** Soft goal (mode 'goal'): the value to aim for, and the worst value still acceptable */
  ideal: number
  acceptable: number
  importance: Importance
}

/** What the generator may change and what it must respect (SPEC §10.2). Lengths in mm, angles in radians. */
export interface Brief {
  /** Mirrored foot, pin on the centreline, stance centred under the shaft */
  symmetric: boolean
  /** Allowed numbers of feet */
  feet: number[]
  eccentricity: Span
  /** Pin height above the shaft; null leaves it free (limited by walls and space) */
  pinHeight: Span | null
  /** Sideways pin offset; only used when not symmetric */
  pinOffset: Span
  /** Shaft height above the ground; null leaves it free */
  rideHeight: Span | null
  /** Room for the swept area around the shaft. Front is the direction of travel (−x). */
  space: { above: number; front: number; behind: number }
  /** Smallest radius of curvature where the foot touches the ground */
  minContactRadius: number
  /** Clean handoff: how fast the other feet rise after a handoff (mm per radian of cam) */
  handoffLift: number
  goals: Record<GoalMetric, GoalSetting>
}

export interface GoalInfo {
  metric: GoalMetric
  label: string
  /** Whether smaller or larger values are better */
  better: 'lower' | 'higher'
  /** How values are shown and entered */
  quantity: 'length' | 'percent' | 'perRad'
  /** Only meaningful for asymmetric designs (symmetric ones have no handoff slip) */
  asymmetricOnly?: boolean
  description: string
}

export const GOALS: GoalInfo[] = [
  { metric: 'bob', label: 'Bob', better: 'lower', quantity: 'length', description: 'How much the body rises and falls' },
  { metric: 'stride', label: 'Stride per rev', better: 'higher', quantity: 'length', description: 'Distance travelled per cam revolution' },
  { metric: 'ripple', label: 'Speed ripple', better: 'lower', quantity: 'percent', description: 'Variation of forward speed over a step' },
  { metric: 'kink', label: 'Handoff kink', better: 'lower', quantity: 'perRad', description: 'Jolt in vertical speed when the next foot takes over' },
  { metric: 'slip', label: 'Handoff slip', better: 'lower', quantity: 'perRad', asymmetricOnly: true, description: 'Speed mismatch between feet at a handoff (scrub)' },
  { metric: 'lift', label: 'Foot lift', better: 'higher', quantity: 'length', description: 'How high a swinging foot clears the floor' },
]

export const goalInfo = (metric: GoalMetric): GoalInfo => GOALS.find((g) => g.metric === metric)!

/** Goals that apply to a brief (handoff slip only matters when the design isn't symmetric). */
export const activeGoals = (brief: Brief): GoalInfo[] =>
  GOALS.filter((g) => brief.goals[g.metric].mode !== 'off' && !(g.asymmetricOnly && brief.symmetric))

export type GoalPreset = 'balanced' | 'smooth' | 'fast'

export const GOAL_PRESETS: { id: GoalPreset; label: string }[] = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'fast', label: 'Fast' },
]

const round = (v: number, step = 1) => Math.round(v / step) * step

const setting = (mode: GoalMode, ideal: number, acceptable: number, importance: Importance, limit = acceptable): GoalSetting => ({
  mode,
  limit,
  ideal,
  acceptable,
  importance,
})

/** Goals for a preset. `stride` is a reference stride per revolution (the current design's) that sets the scale. */
export function presetGoals(preset: GoalPreset, stride: number): Record<GoalMetric, GoalSetting> {
  const s = Math.max(10, stride)
  const base: Record<GoalMetric, GoalSetting> = {
    bob: setting('goal', 0, 1, 2),
    stride: setting('goal', round(1.2 * s), round(0.9 * s), 2),
    ripple: setting('goal', 0.15, 0.5, 2),
    kink: setting('off', 0, 5, 2),
    slip: setting('off', 0, 1, 2),
    lift: setting('off', 5, 2, 2, 2),
  }
  if (preset === 'smooth') {
    return {
      ...base,
      bob: setting('goal', 0, 0.5, 4),
      ripple: setting('goal', 0.1, 0.4, 4),
      kink: setting('goal', 0, 5, 2),
      stride: setting('goal', round(s), round(0.75 * s), 1),
    }
  }
  if (preset === 'fast') {
    return {
      ...base,
      stride: setting('goal', round(1.5 * s), round(1.1 * s), 4),
      bob: setting('goal', 0, 2, 1),
      ripple: setting('goal', 0.2, 0.6, 1),
    }
  }
  return base
}

/**
 * A brief that starts from the current design: its feet count, eccentricity and pin, the space its
 * swept area uses (plus a margin), its ride height, and Balanced goals scaled to its stride.
 */
export function createBrief(design: Design, analysis: Analysis | null): Brief {
  const L = design.drive.L
  const pin = design.constraint.pin
  const k = analysis?.kinematics ?? null
  const swept = analysis?.swept() ?? null
  const ride = k ? -(k.envelope.minY + k.envelope.maxY) / 2 : 55
  let above = Math.hypot(pin.x, pin.y) + 2 * L + 15
  let front = 60
  let behind = 60
  if (swept && swept.boundary.length > 0) {
    const pts = swept.boundary.flatMap((b) => [b.p0, b.p1, b.p2, b.p3])
    above = Math.max(...pts.map((p) => p.y)) + 5
    front = -Math.min(...pts.map((p) => p.x)) + 5
    behind = Math.max(...pts.map((p) => p.x)) + 5
  }
  const feet = [...new Set([3, 4, 5, design.feet.count])]
    .filter((n) => n >= MIN_FEET && n <= MAX_FEET)
    .sort((a, b) => a - b)
  return {
    symmetric: design.foot.mirror && pin.x === 0,
    feet,
    eccentricity: { min: round(Math.max(1, 0.6 * L), 0.5), max: round(1.5 * L, 0.5) },
    pinHeight: null,
    pinOffset: { min: pin.x, max: pin.x },
    rideHeight: { min: round(ride - 5), max: round(ride + 5) },
    space: { above: Math.ceil(above), front: Math.ceil(front), behind: Math.ceil(behind) },
    minContactRadius: 5,
    handoffLift: 1,
    goals: presetGoals('balanced', k?.metrics.strideRev ?? 60),
  }
}
