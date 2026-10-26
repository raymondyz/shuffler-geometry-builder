import type { ReactNode } from 'react'
import type { Analysis, Kinematics } from '../../core/analysis/analyze'
import { operatingMetrics } from '../../core/analysis/metrics'
import { gestureProps, updateDesign } from '../../state/designStore'
import { useUnits } from '../../state/uiStore'
import { InfoTip } from '../common/InfoTip'
import { NumberField } from '../common/NumberField'
import { Section } from '../common/Section'
import {
  formatAngle,
  formatLength,
  formatNumber,
  formatPercent,
  formatPerRad,
  formatSpeed,
  formatVelocity,
  type Units,
} from '../format'
import styles from './panels.module.css'

interface MetricProps {
  label: string
  value: ReactNode
  detail?: ReactNode
  /** What the number means, behind an info icon */
  info: ReactNode
}

/** Headline number: one per primary metric. */
function StatTile({ label, value, detail, info }: MetricProps) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>
        {label}
        <InfoTip label={label}>{info}</InfoTip>
      </span>
      <span className={styles.tileValue}>{value}</span>
      {detail && <span className={styles.tileDetail}>{detail}</span>}
    </div>
  )
}

function MetricRow({ label, value, info }: MetricProps) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>
        {label}
        <InfoTip label={label}>{info}</InfoTip>
      </span>
      <span className={styles.metricValue}>{value}</span>
    </div>
  )
}

/** The metrics that matter while tuning: bob, stride and the two main smoothness parts. */
export function ResultsSection({ analysis }: { analysis: Analysis }) {
  const units = useUnits()
  const m = analysis.kinematics?.metrics
  return (
    <Section title="Results">
      {!m ? (
        <p className={styles.note}>No results until the errors above are fixed.</p>
      ) : (
        <>
          <div className={styles.tiles}>
            <StatTile label="Bob" value={formatLength(m.bob, units)} info="How far the robot rises and falls as it walks, peak to peak. Lower is smoother." />
            <StatTile
              label="Stride per rev"
              value={formatLength(m.strideRev, units)}
              detail={`${formatLength(m.strideStep, units)} per step`}
              info="How far the robot travels per cam revolution. Per step is the distance covered while one foot carries it."
            />
          </div>
          <MetricRow label="Handoff kink" value={formatPerRad(m.handoffKink, units)} info="The sudden change in vertical speed when the next foot takes over, per radian of cam: the jolt at each step. Lower is smoother." />
          <MetricRow label="Speed ripple" value={formatPercent(m.speedRipple)} info="How much the forward speed varies during a step, as (max − min) ÷ mean. Lower means steadier driving." />
        </>
      )}
    </Section>
  )
}

function SecondaryRows({ k, rpm, units }: { k: Kinematics; rpm: number; units: Units }) {
  const m = k.metrics
  const op = operatingMetrics(m, rpm)
  return (
    <>
      <MetricRow label="Ground speed" value={formatSpeed(op.groundSpeed, units)} info={`Robot speed at the cam shaft speed above. With the cam turning counter-clockwise, the robot moves toward ${m.direction < 0 ? '−x' : '+x'}.`} />
      <MetricRow label="Touchdown speed" value={formatVelocity(op.verticalJump, units)} info="How fast each new foot meets the ground relative to the body (handoff kink × shaft speed): how hard each step lands." />
      <MetricRow label="Peak vertical accel." value={`${formatNumber(op.peakAccel, 2)} g`} info="Largest vertical acceleration of the robot between handoffs, in g." />
      <MetricRow label="Handoff slip" value={formatPerRad(m.handoffSlip, units)} info="Difference in ground speed between the outgoing and incoming foot at a handoff. Above zero, a foot scrubs along the floor." />
      <MetricRow label="Tilt range" value={`±${formatAngle(Math.max(-m.tiltRange[0], m.tiltRange[1]))}`} info="How far each foot rocks either way over a revolution." />
      <MetricRow label="Foot lift" value={formatLength(m.footLift, units)} info="How high a swinging foot clears the floor." />
      <MetricRow label="Double support" value={formatPercent(m.doubleSupport)} info="Share of the revolution with two feet on the ground at once. If they move at different speeds, one scrubs." />
    </>
  )
}

/** Shaft speed and secondary results, collapsed by default. */
export function MoreResultsSection({ analysis }: { analysis: Analysis }) {
  const units = useUnits()
  const rpm = analysis.design.operating.shaftRpm
  return (
    <Section title="More results" defaultOpen={false}>
      <NumberField
        label="Cam shaft speed"
        suffix="rpm"
        min={0}
        integer
        value={rpm}
        onChange={(shaftRpm) => updateDesign((d) => ({ ...d, operating: { shaftRpm } }))}
        info="Only used to turn the per-revolution results below into real speeds and accelerations."
        {...gestureProps}
      />
      {analysis.kinematics && <SecondaryRows k={analysis.kinematics} rpm={rpm} units={units} />}
    </Section>
  )
}
