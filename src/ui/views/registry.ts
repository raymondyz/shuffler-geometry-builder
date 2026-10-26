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
  {
    id: 'path',
    title: 'Foot path',
    area: 'primary',
    component: PathView,
    actions: PathViewActions,
    info:
      "One cam and foot, animated. The line traces the foot's lowest point over a revolution; the thick part is the stance, " +
      'where this foot carries the robot. The ruler is the ground, sliding by the distance the robot really travels. ' +
      'In Generate mode the shaded swept area must fit inside the dashed space box. Scroll or pinch to zoom, drag to pan.',
  },
  {
    id: 'editor',
    title: 'Foot editor',
    area: 'secondary',
    component: FootEditor,
    actions: FootEditorActions,
    modes: ['design'],
    info:
      'The foot in its own frame: the cam bearing centre P1 is at the origin and the slot points up. Drag anchors and handles ' +
      'to reshape it, and double-click an edge to add an anchor. The blue band is the part that touches the ground. ' +
      'Scroll or pinch to zoom, drag the background to pan.',
  },
  {
    id: 'preview',
    title: 'Foot',
    area: 'secondary',
    component: FootPreview,
    modes: ['generate'],
    info: 'The selected generated foot, read only. Press Use this design to edit it. Scroll or pinch to zoom, drag to pan.',
  },
  {
    id: 'candidates',
    title: 'Candidates',
    area: 'bottom',
    component: CandidatesView,
    actions: CandidatesActions,
    modes: ['generate'],
    info: 'Generated designs, best first, with a column for each goal you set. Click a row to preview it in every view.',
  },
  {
    id: 'height',
    title: 'Lowest point vs cam angle',
    area: 'bottom',
    component: HeightChart,
    actions: HeightChartActions,
    info:
      "The height of every foot's lowest point as the cam turns. The robot rests on whichever foot is lowest, so the grey " +
      'envelope underneath is its up-and-down motion (bob). Dots mark handoffs, where the next foot takes over. Drag to scrub.',
  },
]
