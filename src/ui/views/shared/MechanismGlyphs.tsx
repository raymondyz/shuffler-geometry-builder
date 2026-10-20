import type { CSSProperties } from 'react'
import type { ShaftSpec } from '../../../core/design/schema'
import { radToDeg } from '../../../core/math/angle'
import { fromAngle, type Vec2 } from '../../../core/math/vec2'
import styles from './mechanism.module.css'

export interface FootPose {
  p1: Vec2
  alpha: number
}

interface FootGlyphProps {
  pose: FootPose
  /** Paths in the foot frame */
  outlinePath: string
  slotPath: string
  boreRadius: number
  /** Faint outline-only rendering for secondary feet */
  ghost?: boolean
  color?: string
}

/** One foot placed at its pose: outline, cam bore and slot (body frame). */
export function FootGlyph({ pose, outlinePath, slotPath, boreRadius, ghost, color }: FootGlyphProps) {
  return (
    <g
      className={ghost ? styles.ghost : styles.foot}
      style={color ? ({ '--foot-color': color } as CSSProperties) : undefined}
      transform={`translate(${pose.p1.x} ${pose.p1.y}) rotate(${radToDeg(pose.alpha)})`}
    >
      <path d={outlinePath} className={styles.footBody} />
      <path d={slotPath} className={styles.cutout} />
      <circle r={boreRadius} className={styles.cutout} />
    </g>
  )
}

interface CamGlyphProps {
  phi: number
  p1: Vec2
  camRadius: number
  shaft: ShaftSpec
  ghost?: boolean
}

/** Cam disc around P1 with the shaft at P0 turning with it. */
export function CamGlyph({ phi, p1, camRadius, shaft, ghost }: CamGlyphProps) {
  return (
    <g className={ghost ? styles.ghostCam : undefined}>
      <circle cx={p1.x} cy={p1.y} r={camRadius} className={styles.cam} />
      <line x1={0} y1={0} x2={p1.x} y2={p1.y} className={styles.eccentric} />
      {!ghost && <ShaftGlyph phi={phi} shaft={shaft} />}
    </g>
  )
}

function ShaftGlyph({ phi, shaft }: { phi: number; shaft: ShaftSpec }) {
  if (shaft.kind === 'round') return <circle r={shaft.size / 2} className={styles.shaft} />
  const r = shaft.size / Math.sqrt(3)
  const points = Array.from({ length: 6 }, (_, i) => fromAngle(phi + Math.PI / 6 + (i * Math.PI) / 3, r))
  return <polygon points={points.map((p) => `${p.x},${p.y}`).join(' ')} className={styles.shaft} />
}

/** Stationary shaft (pin) at Ps. */
export function PinGlyph({ at, radius }: { at: Vec2; radius: number }) {
  return <circle cx={at.x} cy={at.y} r={radius} className={styles.pin} />
}
