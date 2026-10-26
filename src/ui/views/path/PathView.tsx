import { memo, useMemo } from 'react'
import type { Analysis, Kinematics } from '../../../core/analysis/analyze'
import { boreRadius, camRadius, slotRadius } from '../../../core/design/hardware'
import type { ShaftSpec } from '../../../core/design/schema'
import { TAU } from '../../../core/math/angle'
import { length } from '../../../core/math/vec2'
import { usePlayhead } from '../../../state/playhead'
import type { Brief } from '../../../core/generate/brief'
import { useGeneratorStore } from '../../../state/generatorStore'
import { useUiStore } from '../../../state/uiStore'
import { Checkbox } from '../../common/Checkbox'
import { EmptyState } from '../../common/Panel'
import { Legend, Swatch, type LegendEntry } from '../../plot/Legend'
import { closedBeziersPath, curve2DPath, segmentsPath } from '../../plot/paths'
import { Viewport, WorldText } from '../../plot/Viewport'
import { useViewport, type Bounds } from '../../plot/viewportContext'
import plotStyles from '../../plot/plot.module.css'
import { footColor } from '../palette'
import { GroundRuler } from '../shared/GroundRuler'
import { CamGlyph, FootGlyph, PinGlyph } from '../shared/MechanismGlyphs'
import styles from '../shared/mechanism.module.css'
import { Transport } from '../shared/Transport'
import type { ViewProps } from '../types'

function pathBounds(analysis: Analysis, space: Brief['space'] | null): Bounds {
  const { outline, design, mechanism } = analysis
  const reach = Math.max(Math.max(...(outline?.polyline() ?? [{ x: 50, y: 50 }]).map(length)), camRadius(design)) + design.drive.L
  const pin = mechanism.constraint.pin
  const pinR = design.hardware.pinDiameter / 2
  return {
    min: { x: Math.min(-reach, pin.x - pinR, space ? -space.front : Infinity), y: -reach },
    max: { x: Math.max(reach, pin.x + pinR, space ? space.behind : -Infinity), y: Math.max(reach, pin.y + pinR, space ? space.above : -Infinity) },
  }
}

/** The room the brief allows (Generate mode): sides and top of a box around the shaft, down to the floor. */
function SpaceBox({ space, groundY }: { space: Brief['space']; groundY: number }) {
  return <path d={`M ${-space.front} ${groundY} V ${space.above} H ${space.behind} V ${groundY}`} className={styles.spaceBox} />
}

/** Everything the foot and cam sweep over a revolution (SPEC §4.6): the keep-out zone, drawn behind everything. */
const SweptLayer = memo(function SweptLayer({ analysis }: { analysis: Analysis }) {
  const swept = analysis.swept()
  if (!swept || swept.boundary.length === 0) return null
  return <path d={closedBeziersPath(swept.boundary)} className={styles.swept} />
})

/** The cam centre's orbit. */
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

/**
 * Ground and foot 1's contact point, on top of everything. The ground ruler slides by −X(φ), the robot's
 * no-slip travel (SPEC §7.4); counting whole turns keeps it continuous across the 360° wrap.
 */
function AnimatedMarkers({ kinematics, shaftRadius }: { kinematics: Kinematics; shaftRadius: number }) {
  const phi = usePlayhead((s) => s.phi)
  const turns = usePlayhead((s) => s.turns)
  const { px } = useViewport()
  const contact = kinematics.model.sample(phi).contact
  const ground = kinematics.envelopeAt(phi)
  return (
    <g>
      <GroundRuler y={ground.y} offset={-kinematics.travelAt(phi + turns * TAU)} />
      <circle cx={contact.x} cy={contact.y} r={px(4.5)} className={styles.contact} />
      <WorldText at={{ x: shaftRadius, y: 0 }} dx={4} dy={-4}>P0</WorldText>
    </g>
  )
}

/** Notes over the canvas: why nothing moves, or why the swept area is an upper bound. */
function PathOverlay({ analysis, showSwept }: { analysis: Analysis; showSwept: boolean }) {
  if (!analysis.kinematics) return <div className={plotStyles.overlay}>Fix the errors in the sidebar to animate the mechanism.</div>
  if (showSwept && analysis.swept()?.exact === false) {
    return (
      <div className={plotStyles.overlay}>
        Swept area is drawn slightly large: part of the foot is hidden from the cam shaft (a hook or deep notch).
      </div>
    )
  }
  return null
}

const LEGEND: LegendEntry[] = [
  { label: 'Lowest-point path', color: 'var(--text-muted)' },
  { label: 'Stance', color: footColor(0), width: 3 },
]

/** In Generate mode the swept area is always shown, next to the space it must fit */
const GENERATE_LEGEND: LegendEntry[] = [
  { label: 'Space', color: 'var(--text-secondary)', kind: 'dashed' },
  { label: 'Swept area', color: 'var(--text-muted)', kind: 'area' },
  ...LEGEND,
]

/** Header legend and the display toggles. The swept-area toggle doubles as its legend entry. */
export function PathViewActions() {
  const showAllFeet = useUiStore((s) => s.showAllFeet)
  const showSwept = useUiStore((s) => s.showSwept)
  const generating = useUiStore((s) => s.mode === 'generate')
  const setPreference = useUiStore((s) => s.setPreference)
  return (
    <>
      <Legend entries={generating ? GENERATE_LEGEND : LEGEND} />
      {!generating && (
        <Checkbox
          label={<><Swatch color="var(--text-muted)" kind="area" />Swept area</>}
          infoLabel="Swept area"
          info="Everything the foot and cam pass through over a revolution. Keep frame parts, standoffs and armour out of it, in the plane of each foot."
          checked={showSwept}
          onChange={(v) => setPreference('showSwept', v)}
        />
      )}
      <Checkbox label="Show all feet" checked={showAllFeet} onChange={(v) => setPreference('showAllFeet', v)} />
    </>
  )
}

export function PathView({ analysis }: ViewProps) {
  const showAllFeet = useUiStore((s) => s.showAllFeet)
  const generating = useUiStore((s) => s.mode === 'generate')
  const space = useGeneratorStore((s) => (generating ? s.brief?.space ?? null : null))
  const showSwept = useUiStore((s) => s.showSwept) || generating
  const { outline, mechanism, kinematics, design } = analysis
  const bounds = useMemo(() => pathBounds(analysis, space), [analysis, space])
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
        ariaLabel="Side view of one cam and foot with the path of its lowest point and the area the foot sweeps"
        overlay={<PathOverlay analysis={analysis} showSwept={showSwept} />}
      >
        {showSwept && <SweptLayer analysis={analysis} />}
        {space && <SpaceBox space={space} groundY={kinematics?.envelope.minY ?? -Math.max(space.above, 60)} />}
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
