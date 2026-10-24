import type { Outline, OutlineEdge, OutlineNode } from '../curves/outline'
import { splitCubic, startPoint, type Segment } from '../curves/segment'
import { newNodeId } from '../design/presets'
import { TAU } from '../math/angle'
import { cross, dot, length, sub, type Vec2 } from '../math/vec2'
import { mergeLoop } from './segments'

// Closed chain of segments → the editor's nodes and edges (SPEC §14.9).

const ZERO: Vec2 = { x: 0, y: 0 }
/** Two cubics meeting with handles this close to opposite count as a smooth anchor */
const SMOOTH_ANGLE = (0.1 * Math.PI) / 180

/** Split pieces an outline edge can't hold: a lone closed segment, or an arc too long for its bulge. */
function editable(segments: Segment[]): Segment[] {
  const out = segments.flatMap((s): Segment[] => {
    if (s.kind === 'arc' && Math.abs(s.sweep) > TAU * 0.75) {
      return [{ ...s, sweep: s.sweep / 2 }, { ...s, startAngle: s.startAngle + s.sweep / 2, sweep: s.sweep / 2 }]
    }
    return [s]
  })
  if (out.length === 1) {
    const s = out[0]
    if (s.kind === 'cubic') return splitCubic(s, 0.5)
    if (s.kind === 'arc') return [{ ...s, sweep: s.sweep / 2 }, { ...s, startAngle: s.startAngle + s.sweep / 2, sweep: s.sweep / 2 }]
  }
  return out
}

/** Editable outline from a closed chain: anchors at segment starts, with collinear lines and co-circular arcs merged. */
export function outlineFromSegments(chain: Segment[]): Outline {
  const segments = editable(mergeLoop(chain))
  const n = segments.length
  const nodes: OutlineNode[] = segments.map((s) => ({ id: newNodeId(), p: startPoint(s), hIn: ZERO, hOut: ZERO, mode: 'corner' }))
  const edges: OutlineEdge[] = segments.map((s) => (s.kind === 'arc' ? { kind: 'arc', bulge: Math.tan(s.sweep / 4) } : { kind: s.kind, bulge: 0 }))
  segments.forEach((s, i) => {
    if (s.kind !== 'cubic') return
    const next = (i + 1) % n
    nodes[i] = { ...nodes[i], hOut: sub(s.p1, nodes[i].p) }
    nodes[next] = { ...nodes[next], hIn: sub(s.p2, nodes[next].p) }
  })
  return {
    nodes: nodes.map((nd, i) => {
      const before = segments[(i - 1 + n) % n]
      const a = nd.hIn
      const b = nd.hOut
      const la = length(a)
      const lb = length(b)
      const opposite = la > 0 && lb > 0 && dot(a, b) < 0 && Math.abs(cross(a, b)) <= Math.sin(SMOOTH_ANGLE) * la * lb
      return before.kind === 'cubic' && segments[i].kind === 'cubic' && opposite ? { ...nd, mode: 'smooth' } : nd
    }),
    edges,
  }
}
