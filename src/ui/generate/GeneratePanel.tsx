import { activeGoals, GOAL_PRESETS, GOALS, presetGoals, type Brief, type GoalPreset } from '../../core/generate/brief'
import { MAX_FEET, MIN_FEET } from '../../core/design/schema'
import { useGeneratorStore } from '../../state/generatorStore'
import { useDesignAnalysis } from '../../state/useAnalysis'
import { useDesignStore } from '../../state/designStore'
import { Button } from '../common/Button'
import { Checkbox } from '../common/Checkbox'
import { InfoTip } from '../common/InfoTip'
import controls from '../common/controls.module.css'
import { NumberField } from '../common/NumberField'
import { Section } from '../common/Section'
import { HardwareSection } from '../panels/ParametersPanel'
import panels from '../panels/panels.module.css'
import styles from './generate.module.css'
import { GoalRow } from './GoalRow'
import { SpanField } from './SpanField'

/** How far the other feet must have lifted, measured 10° of cam after a handoff */
const LIFT_ANGLE = Math.PI / 18

type Update = (fn: (b: Brief) => Brief) => void

function LayoutSection({ brief, update }: { brief: Brief; update: Update }) {
  const toggleFeet = (n: number) =>
    update((b) => ({ ...b, feet: b.feet.includes(n) ? b.feet.filter((f) => f !== n) : [...b.feet, n].sort((x, y) => x - y) }))
  return (
    <Section title="Layout">
      <Checkbox
        label="Symmetric"
        checked={brief.symmetric}
        info="Search only mirror-symmetric feet with the pin on the centreline. The search is faster, and the motion is the same in both directions."
        onChange={(symmetric) => update((b) => ({ ...b, symmetric }))}
      />
      <div className={styles.item}>
        <span className={styles.itemLabel}>
          Feet to try
          <InfoTip label="Feet to try">Each number of feet picked here is searched, and the best design for each is listed.</InfoTip>
        </span>
        <div className={styles.chips} role="group" aria-label="Numbers of feet to try">
          {Array.from({ length: MAX_FEET - MIN_FEET + 1 }, (_, i) => MIN_FEET + i).map((n) => (
            <button key={n} type="button" className={styles.chip} aria-pressed={brief.feet.includes(n)} onClick={() => toggleFeet(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <SpanField
        label="Eccentricity L"
        value={brief.eccentricity}
        fallback={brief.eccentricity}
        min={0.5}
        onChange={(v) => v && update((b) => ({ ...b, eccentricity: v }))}
        info="How far the cam disc centre is offset from the cam shaft, as in the Mechanism section. Fixed, or a range to search."
      />
      <SpanField
        label="Pin height"
        value={brief.pinHeight}
        fallback={{ min: 40, max: 40 }}
        allowFree
        onChange={(pinHeight) => update((b) => ({ ...b, pinHeight }))}
        info="Height of the pin above the cam shaft. Free lets the search use anything the walls and the space allow."
      />
      {!brief.symmetric && (
        <SpanField
          label="Pin offset"
          value={brief.pinOffset}
          fallback={brief.pinOffset}
          min={-1000}
          onChange={(v) => v && update((b) => ({ ...b, pinOffset: v }))}
          info="Sideways position of the pin, from the cam shaft."
        />
      )}
    </Section>
  )
}

function SpaceSection({ brief, update }: { brief: Brief; update: Update }) {
  const setSpace = (patch: Partial<Brief['space']>) => update((b) => ({ ...b, space: { ...b.space, ...patch } }))
  return (
    <Section title="Space">
      <SpanField
        label="Shaft above ground"
        value={brief.rideHeight}
        fallback={{ min: 55, max: 55 }}
        allowFree
        onChange={(rideHeight) => update((b) => ({ ...b, rideHeight }))}
        info="Ride height: how high the cam shaft sits above the floor."
      />
      <NumberField label="Room above shaft" quantity="length" min={1} value={brief.space.above} onChange={(above) => setSpace({ above })} />
      {brief.symmetric ? (
        <NumberField
          label="Room each side"
          quantity="length"
          min={1}
          value={Math.min(brief.space.front, brief.space.behind)}
          onChange={(v) => setSpace({ front: v, behind: v })}
        />
      ) : (
        <>
          <NumberField label="Room in front" quantity="length" min={1} value={brief.space.front} onChange={(front) => setSpace({ front })} />
          <NumberField label="Room behind" quantity="length" min={1} value={brief.space.behind} onChange={(behind) => setSpace({ behind })} />
        </>
      )}
      <p className={panels.note}>Measured from the cam shaft. The swept area must fit; the box is drawn in the foot path view.</p>
    </Section>
  )
}

function GoalsSection({ brief, update, strideRef }: { brief: Brief; update: Update; strideRef: number }) {
  return (
    <Section title="Goals">
      <div className={styles.presetRow}>
        <select
          className={controls.select}
          aria-label="Fill in goals from a preset"
          value=""
          onChange={(e) => update((b) => ({ ...b, goals: presetGoals(e.target.value as GoalPreset, strideRef) }))}
        >
          <option value="" disabled>
            Presets…
          </option>
          {GOAL_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <InfoTip label="goals">
          Off: ignored. Limit: a hard requirement, in the metric's own units. Goal: an ideal value and the worst acceptable
          one; the search improves the worst-off goal first, and Importance sets which goals give way. Presets fill in a sensible set.
        </InfoTip>
      </div>
      {GOALS.filter((g) => !(g.asymmetricOnly && brief.symmetric)).map((g) => (
        <GoalRow
          key={g.metric}
          info={g}
          setting={brief.goals[g.metric]}
          onChange={(setting) => update((b) => ({ ...b, goals: { ...b.goals, [g.metric]: setting } }))}
        />
      ))}
    </Section>
  )
}

function ShapeSection({ brief, update }: { brief: Brief; update: Update }) {
  return (
    <Section title="Foot shape" defaultOpen={false}>
      <NumberField
        label="Min contact radius"
        quantity="length"
        min={0.5}
        value={brief.minContactRadius}
        onChange={(minContactRadius) => update((b) => ({ ...b, minContactRadius }))}
        info="The tightest curve allowed where the foot touches the ground. Larger means less wear and contact stress, and no sharp corners there."
      />
      <NumberField
        label="Lift 10° after handoff"
        quantity="length"
        min={0}
        value={brief.handoffLift * LIFT_ANGLE}
        onChange={(v) => update((b) => ({ ...b, handoffLift: v / LIFT_ANGLE }))}
        info="How far the other feet must have risen 10° of cam after a handoff. Zero lets two feet share the ground, which can make one scrub."
      />
    </Section>
  )
}

function RunBar({ brief }: { brief: Brief }) {
  const status = useGeneratorStore((s) => s.status)
  const progress = useGeneratorStore((s) => s.progress)
  const run = useGeneratorStore((s) => s.run)
  const stop = useGeneratorStore((s) => s.stop)
  const resetBrief = useGeneratorStore((s) => s.resetBrief)
  const design = useDesignStore((s) => s.design)
  const analysis = useDesignAnalysis()
  const ready = activeGoals(brief).length > 0 && brief.feet.length > 0
  return (
    <div className={styles.runBar}>
      {status === 'running' ? (
        <div className={styles.runRow}>
          <progress className={styles.progress} value={progress} max={1} aria-label="Search progress" />
          <Button onClick={stop}>Stop</Button>
        </div>
      ) : (
        <div className={styles.runRow}>
          <Button variant="primary" disabled={!ready} onClick={run}>
            Generate
          </Button>
          <Button variant="ghost" title="Start the brief again from the current design" onClick={() => resetBrief(design, analysis)}>
            Reset
          </Button>
        </div>
      )}
      {!ready && <p className={styles.hint}>{brief.feet.length === 0 ? 'Pick at least one number of feet.' : 'Set at least one goal or limit.'}</p>}
    </div>
  )
}

/**
 * Sidebar in Generate mode: the brief (SPEC §10.2, §13.6). Sections are direct children of the
 * sidebar so the tablet layout can flow them into columns; the run bar sticks to the bottom.
 */
export function GeneratePanel() {
  const brief = useGeneratorStore((s) => s.brief)
  const update = useGeneratorStore((s) => s.updateBrief)
  const strideRef = useDesignAnalysis().kinematics?.metrics.strideRev ?? 60
  if (!brief) return null
  return (
    <>
      <LayoutSection brief={brief} update={update} />
      <SpaceSection brief={brief} update={update} />
      <GoalsSection brief={brief} update={update} strideRef={strideRef} />
      <ShapeSection brief={brief} update={update} />
      <HardwareSection />
      <RunBar brief={brief} />
    </>
  )
}
