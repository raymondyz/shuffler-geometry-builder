import { compileOutline, signedArea, type Outline, type OutlineNode } from '../curves/outline'
import { pointAt } from '../curves/segment'
import { rootsOnInterval } from '../math/roots'
import type { Vec2 } from '../math/vec2'
import { freeOps, insertNode, nodeIndex, reverseOutline, rotateOutline, type OutlineOps } from './outlineEdit'
import { newNodeId } from './presets'

// Mirrored outlines are symmetric about the foot centreline (x = 0) and kept in a canonical form:
//   counter-clockwise, node 0 = bottom anchor on the axis, node n/2 = top anchor on the axis,
//   nodes 1..n/2−1 = right half, nodes n/2+1..n−1 = mirror images of the right half in reverse.
// The right half is the source of truth; the left half is always rebuilt from it.

const MIRROR_SUFFIX = ':m'

const reflect = (v: Vec2): Vec2 => ({ x: -v.x, y: v.y })

const mirrorId = (id: string): string => `${id}${MIRROR_SUFFIX}`

const half = (o: Outline): number => o.nodes.length / 2

/** Force an axis anchor onto x = 0 with mirror-image handles (horizontal unless it is a corner). */
function axisNode(nd: OutlineNode, which: 'bottom' | 'top'): OutlineNode {
  const p = { x: 0, y: nd.p.y }
  if (which === 'bottom') {
    const hOut = nd.mode === 'corner' ? nd.hOut : { x: nd.hOut.x, y: 0 }
    return { ...nd, p, hOut, hIn: reflect(hOut) }
  }
  const hIn = nd.mode === 'corner' ? nd.hIn : { x: nd.hIn.x, y: 0 }
  return { ...nd, p, hIn, hOut: reflect(hIn) }
}

/** Rebuild the left half from the right half (nodes 0..top, edges 0..top−1). */
export function rebuildMirror(o: Outline, top = half(o)): Outline {
  const right = o.nodes.slice(0, top + 1).map((nd, j) => {
    if (j === 0) return axisNode(nd, 'bottom')
    if (j === top) return axisNode(nd, 'top')
    return nd
  })
  const left: OutlineNode[] = []
  for (let j = top - 1; j >= 1; j--) {
    const nd = right[j]
    left.push({ id: mirrorId(nd.id), p: reflect(nd.p), hIn: reflect(nd.hOut), hOut: reflect(nd.hIn), mode: nd.mode })
  }
  const rightEdges = o.edges.slice(0, top)
  return { nodes: [...right, ...left], edges: [...rightEdges, ...[...rightEdges].reverse()] }
}

/** Split an edge at t, reusing an existing anchor when t is at an end. */
function splitAt(o: Outline, k: number, t: number): { outline: Outline; id: string; inserted: boolean } {
  if (t <= 1e-6) return { outline: o, id: o.nodes[k].id, inserted: false }
  if (t >= 1 - 1e-6) return { outline: o, id: o.nodes[(k + 1) % o.nodes.length].id, inserted: false }
  return { ...insertNode(o, k, t), inserted: true }
}

/**
 * Make any outline mirror-symmetric by keeping its right half (between the lowest and highest
 * centreline crossings) and reflecting it. Returns null if the outline never crosses the centreline.
 */
export function symmetrize(input: Outline): Outline | null {
  if (input.nodes.length < 2) return null
  let o = signedArea(compileOutline(input)) < 0 ? reverseOutline(input) : input
  // Centreline crossings: anchors on the axis (with tolerance) plus crossings inside edges
  const crossings: { k: number; t: number; y: number }[] = []
  o.nodes.forEach((nd, k) => {
    if (Math.abs(nd.p.x) < 1e-9) crossings.push({ k, t: 0, y: nd.p.y })
  })
  compileOutline(o).forEach((seg, k) => {
    for (const t of rootsOnInterval((u) => pointAt(seg, u).x, 0, 1, 64)) {
      if (t > 1e-6 && t < 1 - 1e-6) crossings.push({ k, t, y: pointAt(seg, t).y })
    }
  })
  if (crossings.length < 2) return null
  const bottom = crossings.reduce((a, b) => (b.y < a.y ? b : a))
  const top = crossings.reduce((a, b) => (b.y > a.y ? b : a))
  if (bottom === top) return null

  // Split the later crossing first so the earlier one's edge index stays valid
  const [first, second] = [bottom, top].sort((a, b) => b.k - a.k || b.t - a.t)
  const s1 = splitAt(o, first.k, first.t)
  o = s1.outline
  const t2 = s1.inserted && second.k === first.k ? second.t / first.t : second.t
  const s2 = splitAt(o, second.k, t2)
  o = s2.outline
  const bottomId = first === bottom ? s1.id : s2.id
  const topId = first === top ? s1.id : s2.id

  o = rotateOutline(o, nodeIndex(o, bottomId))
  const m = nodeIndex(o, topId)
  if (m <= 0) return null
  // Right-half ids must be plain so mirrored ids stay unique
  const nodes = o.nodes.map((nd, j) => (j <= m && nd.id.endsWith(MIRROR_SUFFIX) ? { ...nd, id: newNodeId() } : nd))
  return rebuildMirror({ ...o, nodes }, m)
}

/** Map any anchor to its right-half twin. */
function toRight(o: Outline, id: string): { j: number; mirrored: boolean } {
  const j = nodeIndex(o, id)
  return j > half(o) ? { j: o.nodes.length - j, mirrored: true } : { j, mirrored: false }
}

/** Map any edge to its right-half twin. */
function edgeToRight(o: Outline, index: number): { i: number; mirrored: boolean } {
  return index >= half(o) ? { i: o.nodes.length - 1 - index, mirrored: true } : { i: index, mirrored: false }
}

const isAxis = (o: Outline, j: number) => j === 0 || j === half(o)

/** Editing that keeps the outline symmetric: every edit is applied to the right half, then mirrored. */
export const mirrorOps: OutlineOps = {
  moveNode(o, id, p) {
    const { j, mirrored } = toRight(o, id)
    if (j < 0) return o
    const q = mirrored ? reflect(p) : p
    const pos = isAxis(o, j) ? { x: 0, y: q.y } : { x: Math.max(0, q.x), y: q.y }
    return rebuildMirror(freeOps.moveNode(o, o.nodes[j].id, pos))
  },
  moveHandle(o, id, which, offset) {
    const { j, mirrored } = toRight(o, id)
    if (j < 0) return o
    let w = which
    let off = offset
    if (mirrored) {
      w = which === 'in' ? 'out' : 'in'
      off = reflect(offset)
    }
    // An axis anchor's left-side handle is the mirror of its right-side one
    if ((j === 0 && w === 'in') || (j === half(o) && w === 'out')) {
      w = w === 'in' ? 'out' : 'in'
      off = reflect(off)
    }
    return rebuildMirror(freeOps.moveHandle(o, o.nodes[j].id, w, off))
  },
  setNodeMode(o, id, mode) {
    const { j } = toRight(o, id)
    return j < 0 ? o : rebuildMirror(freeOps.setNodeMode(o, o.nodes[j].id, mode))
  },
  setEdgeKind(o, index, kind) {
    return rebuildMirror(freeOps.setEdgeKind(o, edgeToRight(o, index).i, kind))
  },
  setEdgeBulge(o, index, bulge) {
    // Reflection and reversal both flip the arc's sense, so the twin keeps the same bulge
    return rebuildMirror(freeOps.setEdgeBulge(o, edgeToRight(o, index).i, bulge))
  },
  insertNode(o, index, t) {
    const { i, mirrored } = edgeToRight(o, index)
    const result = freeOps.insertNode(o, i, mirrored ? 1 - t : t)
    return { outline: rebuildMirror(result.outline, half(o) + 1), id: mirrored ? mirrorId(result.id) : result.id }
  },
  deleteNode(o, id) {
    if (!mirrorOps.canDelete(o, id)) return o
    const { j } = toRight(o, id)
    return rebuildMirror(freeOps.deleteNode(o, o.nodes[j].id), half(o) - 1)
  },
  canDelete(o, id) {
    const { j } = toRight(o, id)
    return j > 0 && j < half(o)
  },
  isAxisNode(o, id) {
    const j = nodeIndex(o, id)
    return j >= 0 && isAxis(o, j)
  },
}

/** Ops for the current mode. */
export const outlineOps = (mirror: boolean): OutlineOps => (mirror ? mirrorOps : freeOps)
