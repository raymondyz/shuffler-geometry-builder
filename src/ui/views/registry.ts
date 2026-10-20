import { CandidatesActions, CandidatesView } from './candidates/CandidatesView'
import { FootEditor, FootEditorActions } from './editor/FootEditor'
import { FootPreview } from './editor/FootPreview'
import { HeightChart, HeightChartActions } from './height/HeightChart'
import { PathView, PathViewActions } from './path/PathView'
import type { ViewDefinition } from './types'

/**
 * Every view in the app. To add one (e.g. forward motion), write a component that takes
 * `{ analysis }` and add an entry here; views sharing an area are shown as tabs, in this order.
 * `modes` limits a view to Design or Generate mode.
 */
export const views: ViewDefinition[] = [
  { id: 'path', title: 'Foot path', area: 'primary', component: PathView, actions: PathViewActions },
  { id: 'editor', title: 'Foot editor', area: 'secondary', component: FootEditor, actions: FootEditorActions, modes: ['design'] },
  { id: 'preview', title: 'Foot', area: 'secondary', component: FootPreview, modes: ['generate'] },
  { id: 'candidates', title: 'Candidates', area: 'bottom', component: CandidatesView, actions: CandidatesActions, modes: ['generate'] },
  { id: 'height', title: 'Lowest point vs cam angle', area: 'bottom', component: HeightChart, actions: HeightChartActions },
]
