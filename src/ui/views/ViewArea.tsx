import { useState } from 'react'
import type { Analysis } from '../../core/analysis/analyze'
import { useUiStore } from '../../state/uiStore'
import { InfoTip } from '../common/InfoTip'
import { Panel } from '../common/Panel'
import styles from '../common/layout.module.css'
import { views } from './registry'
import type { ViewAreaId } from './types'

interface ViewAreaProps {
  area: ViewAreaId
  analysis: Analysis
  className?: string
}

/** Renders the views registered for one layout area, as tabs when there are several. */
export function ViewArea({ area, analysis, className }: ViewAreaProps) {
  const mode = useUiStore((s) => s.mode)
  const entries = views.filter((v) => v.area === area && (!v.modes || v.modes.includes(mode)))
  const [activeId, setActiveId] = useState(entries[0]?.id)
  const active = entries.find((v) => v.id === activeId) ?? entries[0]
  if (!active) return null
  // The info icon sits right after the title of the view that is showing, so it is clear which one it explains
  const info = active.info && <InfoTip label={active.title}>{active.info}</InfoTip>
  const header = entries.length === 1 ? (
    <>
      {active.title}
      {info}
    </>
  ) : (
    <div role="tablist" aria-label={`${area} views`} className={styles.tabs}>
      {entries.map((v) => (
        <span key={v.id} className={styles.tabGroup}>
          <button type="button" role="tab" className={styles.tab} aria-selected={v.id === active.id} onClick={() => setActiveId(v.id)}>
            {v.title}
          </button>
          {v.id === active.id && info}
        </span>
      ))}
    </div>
  )
  const View = active.component
  const Actions = active.actions
  return (
    <Panel header={header} actions={Actions && <Actions analysis={analysis} />} className={className}>
      <View analysis={analysis} />
    </Panel>
  )
}
