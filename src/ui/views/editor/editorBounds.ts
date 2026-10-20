import type { Analysis } from '../../../core/analysis/analyze'
import { length } from '../../../core/math/vec2'
import type { Bounds } from '../../plot/viewportContext'

/** Foot-frame extents for the editor and preview: the outline, plus room up to the slot. */
export function editorBounds(analysis: Analysis): Bounds {
  const pts = analysis.outline?.polyline() ?? []
  const reach = Math.max(30, ...pts.map(length))
  const top = length(analysis.mechanism.constraint.pin) + analysis.design.drive.L
  return { min: { x: -reach, y: -reach }, max: { x: reach, y: Math.max(reach, top + 10) } }
}
