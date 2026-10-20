import { beziersToPath, segmentsToPath } from '../../core/curves/pathData'
import type { Segment } from '../../core/curves/segment'
import { piece2DToBezier, pieceToBezier, type Curve1D, type Curve2D } from '../../core/spline/curve'

// Path data is cached per curve object: curves are immutable and replaced on every recompute.
const openCache = new WeakMap<object, string>()
const closedCache = new WeakMap<object, string>()

function cached(cache: WeakMap<object, string>, key: object, build: () => string): string {
  let d = cache.get(key)
  if (d === undefined) {
    d = build()
    cache.set(key, d)
  }
  return d
}

/** SVG path for a parametric curve, drawn exactly as cubic Béziers. */
export const curve2DPath = (c: Curve2D): string =>
  cached(openCache, c, () => beziersToPath(c.pieces.map(piece2DToBezier)))

/** SVG path for the graph (t, v(t)) of a scalar curve, drawn exactly as cubic Béziers. */
export const curve1DPath = (c: Curve1D): string =>
  cached(openCache, c, () => beziersToPath(c.pieces.map(pieceToBezier)))

export const segmentsPath = (segments: Segment[], closed = false): string =>
  cached(closed ? closedCache : openCache, segments, () => segmentsToPath(segments, closed))
