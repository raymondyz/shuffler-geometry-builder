import { FootEditor, FootEditorActions } from './editor/FootEditor'
import { HeightChart, HeightChartActions } from './height/HeightChart'
import { PathView, PathViewActions } from './path/PathView'
import type { ViewDefinition } from './types'

/**
 * Every view in the app. To add one (e.g. forward motion), write a component that takes
 * `{ analysis }` and add an entry here; views sharing an area are shown as tabs.
 */
export const views: ViewDefinition[] = [
  { id: 'path', title: 'Foot path', area: 'primary', component: PathView, actions: PathViewActions },
  { id: 'editor', title: 'Foot editor', area: 'secondary', component: FootEditor, actions: FootEditorActions },
  { id: 'height', title: 'Lowest point vs cam angle', area: 'bottom', component: HeightChart, actions: HeightChartActions },
]
