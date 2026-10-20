import { memo, useMemo } from 'react'
import type { Analysis } from '../../../core/analysis/analyze'
import { boreRadius, slotRadius } from '../../../core/design/hardware'
import { length } from '../../../core/math/vec2'
import { MM_PER_INCH, type Units } from '../../format'
import { segmentsPath } from '../../plot/paths'
import { WorldText } from '../../plot/Viewport'
import styles from './editor.module.css'

/** Faint rings around P1 (10 mm or ½ in apart) plus the x/y axes: the r(θ) frame of reference. */
const PolarGrid = memo(function PolarGrid({ radius, units }: { radius: number; units: Units }) {
  const step = units === 'mm' ? 10 : MM_PER_INCH / 2
  const rings = Array.from({ length: Math.ceil(radius / step) }, (_, i) => (i + 1) * step)
  const outer = rings[rings.length - 1] ?? step
  return (
    <g className={styles.polarGrid}>
      {rings.map((r) => <circle key={r} r={r} />)}
      <line x1={-outer} x2={outer} y1={0} y2={0} />
      <line x1={0} x2={0} y1={-outer} y2={outer} />
    </g>
  )
})

/** Cam bore and generated slot, drawn as cut-outs in the foot frame. */
export function Overlays({ analysis, units }: { analysis: Analysis; units: Units }) {
  const { design, mechanism, outline } = analysis
  const h = design.hardware
  const slot = useMemo(() => segmentsPath(mechanism.constraint.slotOutline(slotRadius(h)), true), [mechanism, h])
  const radius = Math.max(20, ...(outline?.polyline() ?? []).map(length))
  return (
    <g>
      <PolarGrid radius={radius} units={units} />
      {design.foot.mirror && <line x1={0} x2={0} y1={-radius - 10} y2={radius + 10} className={styles.mirrorLine} />}
      <circle r={boreRadius(design)} className={styles.cutout} />
      <path d={slot} className={styles.cutout} />
      <WorldText at={{ x: 0, y: 0 }} dx={6} dy={-6}>P1</WorldText>
    </g>
  )
}

/** The part of the outline that touches the ground while carrying the robot. */
export function ContactBand({ analysis }: { analysis: Analysis }) {
  const k = analysis.kinematics
  if (!k) return null
  return <path d={segmentsPath(k.stanceBand())} className={styles.contactBand} pointerEvents="none" />
}
