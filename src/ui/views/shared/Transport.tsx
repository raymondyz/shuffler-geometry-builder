import { degToRad, radToDeg } from '../../../core/math/angle'
import { playheadActions, usePlayhead } from '../../../state/playhead'
import { Button } from '../../common/Button'
import { Select } from '../../common/Select'
import { formatAngle } from '../../format'
import styles from './transport.module.css'

const SPEEDS = [0.1, 0.25, 0.5, 1]

/** Play/pause and scrub the shared cam angle that every view follows. Sits at the foot of a view panel. */
export function Transport() {
  const phi = usePlayhead((s) => s.phi)
  const playing = usePlayhead((s) => s.playing)
  const speed = usePlayhead((s) => s.speed)
  return (
    <div className={styles.transport}>
      <Button
        variant="primary"
        icon={playing ? 'pause' : 'play'}
        aria-label={playing ? 'Pause' : 'Play'}
        title={`${playing ? 'Pause' : 'Play'} (Space)`}
        onClick={playheadActions.toggle}
      />
      <input
        className={styles.scrubber}
        type="range"
        min={0}
        max={360}
        step={0.1}
        value={radToDeg(phi)}
        aria-label="Cam angle of foot 1"
        onChange={(e) => playheadActions.scrubTo(degToRad(Number(e.target.value)))}
      />
      <span className={styles.phi}>φ {formatAngle(phi)}</span>
      <Select
        label="Animation speed"
        value={String(speed)}
        onChange={(v) => playheadActions.setSpeed(Number(v))}
        options={SPEEDS.map((s) => ({ value: String(s), label: `${s} rev/s` }))}
      />
    </div>
  )
}
