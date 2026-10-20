import { useState } from 'react'
import type { Analysis } from '../../core/analysis/analyze'
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
  const entries = views.filter((v) => v.area === area)
  const [activeId, setActiveId] = useState(entries[0]?.id)
  const active = entries.find((v) => v.id === activeId) ?? entries[0]
  if (!active) return null
  const header = entries.length === 1 ? active.title : (
    <div role="tablist" aria-label={`${area} views`}>
      {entries.map((v) => (
        <button key={v.id} type="button" role="tab" className={styles.tab} aria-selected={v.id === active.id} onClick={() => setActiveId(v.id)}>
          {v.title}
        </button>
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
