import type { ComponentType } from 'react'
import type { Analysis } from '../../core/analysis/analyze'

/** Where a view sits in the main layout. Several views in one area become tabs. */
export type ViewAreaId = 'primary' | 'secondary' | 'bottom'

export interface ViewProps {
  analysis: Analysis
}

export interface ViewDefinition {
  id: string
  title: string
  area: ViewAreaId
  component: ComponentType<ViewProps>
  /** Optional controls and legend rendered in the panel header */
  actions?: ComponentType<ViewProps>
}
