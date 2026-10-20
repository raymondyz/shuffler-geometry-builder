import { memo, useMemo } from 'react'
import type { Analysis, Kinematics } from '../../../core/analysis/analyze'
import { boreRadius, camRadius, slotRadius } from '../../../core/design/hardware'
import type { ShaftSpec } from '../../../core/design/schema'
import { length } from '../../../core/math/vec2'
import { usePlayhead } from '../../../state/playhead'
import { useUiStore } from '../../../state/uiStore'
import { Checkbox } from '../../common/Checkbox'
import { EmptyState } from '../../common/Panel'
import { Legend } from '../../plot/Legend'
import { curve2DPath, segmentsPath } from '../../plot/paths'
import { Viewport, WorldText } from '../../plot/Viewport'
import { useViewport, type Bounds } from '../../plot/viewportContext'
import plotStyles from '../../plot/plot.module.css'
import { footColor } from '../palette'
import { CamGlyph, FootGlyph, PinGlyph } from '../shared/MechanismGlyphs'
import styles from '../shared/mechanism.module.css'
import { Transport } from '../shared/Transport'
import type { ViewProps } from '../types'

function pathBounds(analysis: Analysis): Bounds {
  const { outline, design, mechanism } = analysis
  const reach = Math.max(...(outline?.polyline() ?? [{ x: 50, y: 50 }]).map(length)) + design.drive.L
  const pin = mechanism.constraint.pin
  const pinR = design.hardware.pinDiameter / 2
  return {
    min: { x: Math.min(-reach, pin.x - pinR), y: -reach },
    max: { x: Math.max(reach, pin.x + pinR), y: Math.max(reach, pin.y + pinR) },
  }
}

/** The cam centre's orbit, drawn behind everything. */
function OrbitLayer({ L }: { L: number }) {
  return <circle r={L} className={styles.orbit} />
}

/** Lowest-point path, its stance portion and the stationary pin, drawn over the feet. */
const PathLayer = memo(function PathLayer({ analysis }: { analysis: Analysis }) {
  const { design, mechanism, kinematics } = analysis
  return (
    <g>
      {kinematics && <path d={curve2DPath(kinematics.curves.trace)} className={styles.trace} />}
      {kinematics?.stanceTrace().map((c, i) => <path key={i} d={curve2DPath(c)} className={styles.stance} />)}
      <PinGlyph at={mechanism.constraint.pin} radius={design.hardware.pinDiameter / 2} />
    </g>
  )
})

interface AnimatedProps {
  kinematics: Kinematics
  outlinePath: string
  slotPath: string
  camRadius: number
  boreRadius: number
  shaft: ShaftSpec
  showAllFeet: boolean
}

/** Feet and cams at the current cam angle. Kept small: it re-renders every animation frame. */
function AnimatedFeet({ kinematics, outlinePath, slotPath, camRadius, boreRadius, shaft, showAllFeet }: AnimatedProps) {
  const phi = usePlayhead((s) => s.phi)
  const { model, feet, period } = kinematics
  const samples = Array.from({ length: showAllFeet ? feet : 1 }, (_, k) => model.sample(phi + k * period))
  const s0 = samples[0]
  return (
    <g>
      {samples.slice(1).map((s, i) => (
        <g key={i + 1}>
          <FootGlyph pose={s} outlinePath={outlinePath} slotPath={slotPath} boreRadius={boreRadius} ghost color={footColor(i + 1)} />
          <CamGlyph phi={s.phi} p1={s.p1} camRadius={camRadius} shaft={shaft} ghost />
        </g>
      ))}
      <FootGlyph pose={s0} outlinePath={outlinePath} slotPath={slotPath} boreRadius={boreRadius} />
      <CamGlyph phi={phi} p1={s0.p1} camRadius={camRadius} shaft={shaft} />
    </g>
  )
}

/** Ground line and foot 1's contact point, on top of everything. */
function AnimatedMarkers({ kinematics, shaftRadius }: { kinematics: Kinematics; shaftRadius: number }) {
  const phi = usePlayhead((s) => s.phi)
  const { px } = useViewport()
  const contact = kinematics.model.sample(phi).contact
  const ground = kinematics.envelopeAt(phi)
  return (
    <g>
      <line x1={-1e4} x2={1e4} y1={ground.y} y2={ground.y} className={styles.ground} />
      <circle cx={contact.x} cy={contact.y} r={px(4.5)} className={styles.contact} />
      <WorldText at={{ x: shaftRadius, y: 0 }} dx={4} dy={-4}>P0</WorldText>
    </g>
  )
}

/** Header legend and the all-feet toggle. */
export function PathViewActions() {
  const showAllFeet = useUiStore((s) => s.showAllFeet)
  const setPreference = useUiStore((s) => s.setPreference)
  return (
    <>
      <Legend
        entries={[
          { label: 'Lowest-point path', color: 'var(--text-muted)' },
          { label: 'Stance', color: footColor(0), width: 3 },
        ]}
      />
      <Checkbox label="Show all feet" checked={showAllFeet} onChange={(v) => setPreference('showAllFeet', v)} />
    </>
  )
}

export function PathView({ analysis }: ViewProps) {
  const showAllFeet = useUiStore((s) => s.showAllFeet)
  const { outline, mechanism, kinematics, design } = analysis
  const bounds = useMemo(() => pathBounds(analysis), [analysis])
  const slotPath = useMemo(
    () => segmentsPath(mechanism.constraint.slotOutline(slotRadius(design.hardware)), true),
    [mechanism, design.hardware],
  )
  if (!outline) return <EmptyState>Draw a closed foot outline to see its path.</EmptyState>
  const outlinePath = segmentsPath(outline.segments, true)
  return (
    <>
      <Viewport
        bounds={bounds}
        ariaLabel="Side view of one cam and foot with the path of its lowest point"
        overlay={!kinematics && <div className={plotStyles.overlay}>Fix the errors in the sidebar to animate the mechanism.</div>}
      >
        <OrbitLayer L={design.drive.L} />
        {!kinematics && (
          <FootGlyph
            pose={{ p1: mechanism.drive.p1(-Math.PI / 2), alpha: 0 }}
            outlinePath={outlinePath}
            slotPath={slotPath}
            boreRadius={boreRadius(design)}
          />
        )}
        {kinematics && (
          <AnimatedFeet
            kinematics={kinematics}
            outlinePath={outlinePath}
            slotPath={slotPath}
            camRadius={camRadius(design)}
            boreRadius={boreRadius(design)}
            shaft={design.hardware.shaft}
            showAllFeet={showAllFeet}
          />
        )}
        <PathLayer analysis={analysis} />
        {kinematics && <AnimatedMarkers kinematics={kinematics} shaftRadius={design.hardware.shaft.size / Math.sqrt(3)} />}
      </Viewport>
      <Transport />
    </>
  )
}
