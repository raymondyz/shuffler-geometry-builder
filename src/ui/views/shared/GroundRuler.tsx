import { useUnits } from '../../../state/uiStore'
import { MM_PER_INCH, type Units } from '../../format'
import { useViewport } from '../../plot/viewportContext'
import styles from './mechanism.module.css'

/** Finer tick levels show only while they are at least this far apart on screen */
const MIN_GAP_PX = 2.5

interface RulerScale {
  /** Finest tick spacing in mm */
  unit: number
  /** Tick levels, coarsest first: every `every` finest steps, `depth` px long. The first is the major tick. */
  levels: { every: number; depth: number }[]
}

const SCALES: Record<Units, RulerScale> = {
  mm: { unit: 1, levels: [{ every: 10, depth: 9 }, { every: 1, depth: 4 }] },
  // Tape-measure style: 1″, ½″, ¼″, ⅛″, 1/16″
  in: {
    unit: MM_PER_INCH / 16,
    levels: [{ every: 16, depth: 9 }, { every: 8, depth: 7 }, { every: 4, depth: 5.5 }, { every: 2, depth: 4.5 }, { every: 1, depth: 3.5 }],
  },
}

interface GroundRulerProps {
  /** Height of the ground in the body frame */
  y: number
  /** x of the ruler's zero mark: the ground's horizontal position, so the ticks move with the floor */
  offset: number
}

const f = (n: number) => n.toFixed(3)

/** The ground as a ruler fixed to the floor, in the display unit, with ticks below the line. */
export function GroundRuler({ y, offset }: GroundRulerProps) {
  const { px, visible } = useViewport()
  const { unit, levels } = SCALES[useUnits()]
  const shown = levels.filter((l) => l.every * unit >= px(MIN_GAP_PX))
  let minor = ''
  let major = ''
  if (shown.length > 0) {
    const step = shown[shown.length - 1].every
    const top = f(y)
    const ends = shown.map((l) => f(y - px(l.depth)))
    // i counts finest steps from the zero mark, in multiples of the finest level on show
    for (let i = Math.ceil((visible.min.x - offset) / (step * unit)) * step; offset + i * unit <= visible.max.x; i += step) {
      const level = shown.findIndex((l) => i % l.every === 0)
      const tick = `M${f(offset + i * unit)} ${top}V${ends[level]}`
      if (level === 0) major += tick
      else minor += tick
    }
  }
  return (
    <g>
      <line x1={visible.min.x} x2={visible.max.x} y1={y} y2={y} className={styles.ground} />
      {minor && <path d={minor} className={styles.rulerMinor} />}
      {major && <path d={major} className={styles.rulerMajor} />}
    </g>
  )
}
