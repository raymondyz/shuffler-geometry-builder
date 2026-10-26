import type { KeyboardEvent } from 'react'
import { activeGoals, type GoalInfo } from '../../../core/generate/brief'
import type { Candidate } from '../../../core/generate/search'
import { useGeneratorStore } from '../../../state/generatorStore'
import { useUnits } from '../../../state/uiStore'
import { Button } from '../../common/Button'
import { EmptyState } from '../../common/Panel'
import { InfoTip } from '../../common/InfoTip'
import { formatLength, formatPercent, formatPerRad, type Units } from '../../format'
import styles from './candidates.module.css'

function formatValue(info: GoalInfo, value: number, units: Units): string {
  if (info.quantity === 'percent') return formatPercent(value, 0)
  if (info.quantity === 'perRad') return formatPerRad(value, units)
  // Stride is a large number; bob and lift need their small decimals
  return info.metric === 'stride' ? formatLength(value, units, units === 'mm' ? 1 : 2) : formatLength(value, units)
}

/** Plain verdict: how the candidate compares with the brief */
function fitLabel(c: Candidate): string {
  if (c.misses.length > 0) return `Misses ${c.misses.join(', ').toLowerCase()}`
  if (c.shortfall <= 0.05) return 'Ideal'
  if (c.shortfall <= 0.5) return 'Good'
  return 'Acceptable'
}

/** Header action: adopt the selected candidate. */
export function CandidatesActions() {
  const selected = useGeneratorStore((s) => s.selected)
  const apply = useGeneratorStore((s) => s.apply)
  return (
    <Button variant="primary" disabled={selected === null} onClick={apply} title="Replace the current design with this one (undo brings it back)">
      Use this design
    </Button>
  )
}

/** Generated designs, best first. Only the goals the brief uses get a column; clicking a row previews it. */
export function CandidatesView() {
  const brief = useGeneratorStore((s) => s.brief)
  const status = useGeneratorStore((s) => s.status)
  const progress = useGeneratorStore((s) => s.progress)
  const candidates = useGeneratorStore((s) => s.candidates)
  const selected = useGeneratorStore((s) => s.selected)
  const note = useGeneratorStore((s) => s.note)
  const select = useGeneratorStore((s) => s.select)
  const units = useUnits()
  const searching = status === 'running' ? `Searching… ${Math.round(progress * 100)}%` : null

  if (!brief || candidates.length === 0) {
    return <EmptyState>{searching ?? note ?? 'Describe what you need on the left, then press Generate.'}</EmptyState>
  }
  const goals = activeGoals(brief)
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      select(i)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(candidates.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
      select(next)
      ;(e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
    }
  }
  return (
    <div className={styles.wrap}>
      {(searching || note) && <p className={styles.note}>{searching ?? note}</p>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Feet</th>
            <th>L</th>
            <th>Pin</th>
            {goals.map((g) => (
              <th key={g.metric}>{g.label}</th>
            ))}
            <th>
              <span className={styles.headWithInfo}>
                Fit
                <InfoTip label="Fit">
                  Ideal: every goal within 5 % of its ideal. Good, then Acceptable: further from ideal, but within the acceptable values.
                  Misses: names the goal, limit, space or ride height it fails.
                </InfoTip>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, i) => {
            const { pin } = c.design.constraint
            return (
              <tr key={i} tabIndex={0} aria-selected={i === selected} onClick={() => select(i)} onKeyDown={(e) => onKey(e, i)}>
                <td>{c.design.feet.count}</td>
                <td>{formatLength(c.design.drive.L, units, units === 'mm' ? 1 : 3)}</td>
                <td>
                  {formatLength(pin.y, units, units === 'mm' ? 1 : 3)}
                  {pin.x !== 0 && <span className={styles.secondary}> · x {formatLength(pin.x, units, units === 'mm' ? 1 : 3)}</span>}
                </td>
                {goals.map((g) => (
                  <td key={g.metric}>{formatValue(g, c.values[g.metric], units)}</td>
                ))}
                <td className={c.misses.length > 0 ? styles.miss : undefined}>{fitLabel(c)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
