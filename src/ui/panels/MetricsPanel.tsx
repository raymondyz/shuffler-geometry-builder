import type { ReactNode } from 'react'
import type { Analysis, Kinematics } from '../../core/analysis/analyze'
import { operatingMetrics } from '../../core/analysis/metrics'
import { gestureProps, updateDesign } from '../../state/designStore'
import { useUnits } from '../../state/uiStore'
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
  title: string
}

/** Headline number: one per primary metric. */
function StatTile({ label, value, detail, title }: MetricProps) {
  return (
    <div className={styles.tile} title={title}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      {detail && <span className={styles.tileDetail}>{detail}</span>}
    </div>
  )
}

function MetricRow({ label, value, title }: MetricProps) {
  return (
    <div className={styles.metric} title={title}>
      <span className={styles.metricLabel}>{label}</span>
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
            <StatTile label="Bob" value={formatLength(m.bob, units)} title="How much the robot moves up and down (peak to peak)" />
            <StatTile
              label="Stride per rev"
              value={formatLength(m.strideRev, units)}
              detail={`${formatLength(m.strideStep, units)} per step`}
              title="Robot travel per cam revolution, and per foot"
            />
          </div>
          <MetricRow label="Handoff kink" value={formatPerRad(m.handoffKink, units)} title="Jump in vertical speed when the next foot touches down (lower is smoother)" />
          <MetricRow label="Speed ripple" value={formatPercent(m.speedRipple)} title="How much the forward speed varies during a step (lower is smoother)" />
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
      <MetricRow label="Ground speed" value={formatSpeed(op.groundSpeed, units)} title={`Moving toward ${m.direction < 0 ? '−x' : '+x'} with the cam turning counter-clockwise`} />
      <MetricRow label="Touchdown speed" value={formatVelocity(op.verticalJump, units)} title="Handoff kink × shaft speed: how hard each foot lands" />
      <MetricRow label="Peak vertical accel." value={`${formatNumber(op.peakAccel, 2)} g`} title="Largest vertical acceleration of the body between handoffs" />
      <MetricRow label="Handoff slip" value={formatPerRad(m.handoffSlip, units)} title="Ground-speed mismatch between outgoing and incoming feet (scrub)" />
      <MetricRow label="Tilt range" value={`±${formatAngle(Math.max(-m.tiltRange[0], m.tiltRange[1]))}`} title="Foot tilt over the whole cycle" />
      <MetricRow label="Foot lift" value={formatLength(m.footLift, units)} title="How high a swinging foot clears the ground" />
      <MetricRow label="Double support" value={formatPercent(m.doubleSupport)} title="Share of the cycle with two feet on the ground" />
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
        title="Converts the per-revolution results into speeds and accelerations"
        {...gestureProps}
      />
      {analysis.kinematics && <SecondaryRows k={analysis.kinematics} rpm={rpm} units={units} />}
    </Section>
  )
}
