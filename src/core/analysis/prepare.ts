import { buildContactPieces, type ContactPiece } from '../curves/contactPieces'
import { compileOutline, flatten, orientCCW, signedArea, type Outline } from '../curves/outline'
import type { Segment } from '../curves/segment'
import { buildSupportMap, type SupportMap } from '../curves/supportMap'
import type { Vec2 } from '../math/vec2'
import { lazy } from '../util/lazy'

/** Outline stage of the pipeline: rebuilt only when the outline changes. */
export interface PreparedOutline {
  /** Outline in node order, as drawn */
  segments: Segment[]
  /** The same outline, counter-clockwise (input to the contact math) */
  ccw: Segment[]
  area: number
  pieces: ContactPiece[]
  supportMap: SupportMap
  /** Polyline approximation for validation and hit testing only */
  polyline: () => Vec2[]
}

export function prepareOutline(outline: Outline): PreparedOutline | null {
  if (outline.nodes.length < 2 || outline.edges.length !== outline.nodes.length) return null
  const segments = compileOutline(outline)
  const area = signedArea(segments)
  if (!(Math.abs(area) > 1e-6)) return null
  const ccw = orientCCW(segments)
  const pieces = buildContactPieces(ccw)
  return {
    segments,
    ccw,
    area: Math.abs(area),
    pieces,
    supportMap: buildSupportMap(pieces),
    polyline: lazy(() => flatten(ccw)),
  }
}
