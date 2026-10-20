import { add, length, neg, normalize, scale, sub, type Vec2 } from '../math/vec2'
import { bulgeFromMidpoint, compileEdge, type EdgeKind, type NodeMode, type Outline, type OutlineNode } from '../curves/outline'
import { derivAt, pointAt, splitCubic } from '../curves/segment'
import { newNodeId } from './presets'

// Pure operations on the editable outline. Every function returns a new Outline and never mutates.

const MAX_BULGE = 3

export const nodeIndex = (outline: Outline, id: string): number => outline.nodes.findIndex((n) => n.id === id)

function replaceNode(outline: Outline, id: string, fn: (n: OutlineNode) => OutlineNode): Outline {
  return { ...outline, nodes: outline.nodes.map((n) => (n.id === id ? fn(n) : n)) }
}

export function moveNode(outline: Outline, id: string, p: Vec2): Outline {
  return replaceNode(outline, id, (n) => ({ ...n, p }))
}

/** Move one handle; smooth nodes keep the opposite handle collinear, symmetric nodes mirror it. */
export function moveHandle(outline: Outline, id: string, which: 'in' | 'out', offset: Vec2): Outline {
  return replaceNode(outline, id, (n) => {
    const other = which === 'in' ? n.hOut : n.hIn
    let mirrored = other
    if (n.mode === 'symmetric') mirrored = neg(offset)
    if (n.mode === 'smooth' && length(offset) > 0) mirrored = scale(normalize(neg(offset)), length(other))
    return which === 'in' ? { ...n, hIn: offset, hOut: mirrored } : { ...n, hOut: offset, hIn: mirrored }
  })
}

/** Change a node's handle mode, aligning its handles when it becomes smooth or symmetric. */
export function setNodeMode(outline: Outline, id: string, mode: NodeMode): Outline {
  return replaceNode(outline, id, (n) => {
    if (mode === 'corner') return { ...n, mode }
    const through = sub(n.hOut, n.hIn)
    const dir = length(through) > 0 ? normalize(through) : { x: 1, y: 0 }
    if (mode === 'symmetric') {
      const len = (length(n.hIn) + length(n.hOut)) / 2
      return { ...n, mode, hIn: scale(dir, -len), hOut: scale(dir, len) }
    }
    return { ...n, mode, hIn: scale(dir, -length(n.hIn)), hOut: scale(dir, length(n.hOut)) }
  })
}

export function setEdgeBulge(outline: Outline, index: number, bulge: number): Outline {
  const b = Math.max(-MAX_BULGE, Math.min(MAX_BULGE, bulge))
  return { ...outline, edges: outline.edges.map((e, i) => (i === index ? { ...e, bulge: b } : e)) }
}

/** Change an edge's kind, converting its shape so the edge looks the same where possible. */
export function setEdgeKind(outline: Outline, index: number, kind: EdgeKind): Outline {
  const edge = outline.edges[index]
  if (edge.kind === kind) return outline
  const n = outline.nodes.length
  const a = outline.nodes[index]
  const b = outline.nodes[(index + 1) % n]
  const seg = compileEdge(outline, index)
  let next: Outline = { ...outline, edges: outline.edges.map((e, i) => (i === index ? { ...e, kind } : e)) }
  if (kind === 'arc') {
    let bulge = bulgeFromMidpoint(a.p, b.p, pointAt(seg, 0.5))
    if (Math.abs(bulge) < 0.05) bulge = 0.2
    next = setEdgeBulge(next, index, bulge)
  }
  if (kind === 'cubic') {
    // Handles that reproduce the old edge: 1/3 of the chord for lines, the standard 4/3·tan(θ/4) fit for arcs
    const k = seg.kind === 'arc' ? (4 / 3) * Math.tan(Math.abs(seg.sweep) / 4) * seg.radius : length(sub(b.p, a.p)) / 3
    const hOut = scale(normalize(derivAt(seg, 0)), k)
    const hIn = scale(normalize(derivAt(seg, 1)), -k)
    next = {
      ...next,
      nodes: next.nodes.map((nd) => {
        if (nd.id === a.id) return { ...nd, hOut }
        if (nd.id === b.id) return { ...nd, hIn }
        return nd
      }),
    }
  }
  return next
}

/** Insert an anchor on edge `index` at parameter t without changing the outline's shape. */
export function insertNode(outline: Outline, index: number, t: number): { outline: Outline; id: string } {
  const n = outline.nodes.length
  const a = outline.nodes[index]
  const b = outline.nodes[(index + 1) % n]
  const edge = outline.edges[index]
  const seg = compileEdge(outline, index)
  const id = newNodeId()
  const p = pointAt(seg, t)
  let mid: OutlineNode
  let aNode = a
  let bNode = b
  let edgeA = edge
  let edgeB = edge
  if (seg.kind === 'cubic') {
    const [left, right] = splitCubic(seg, t)
    aNode = { ...a, hOut: sub(left.p1, left.p0) }
    bNode = { ...b, hIn: sub(right.p2, right.p3) }
    mid = { id, p, hIn: sub(left.p2, p), hOut: sub(right.p1, p), mode: 'smooth' }
  } else if (seg.kind === 'arc') {
    edgeA = { kind: 'arc', bulge: Math.tan((seg.sweep * t) / 4) }
    edgeB = { kind: 'arc', bulge: Math.tan((seg.sweep * (1 - t)) / 4) }
    const tangent = scale(normalize(derivAt(seg, t)), Math.abs(seg.radius * seg.sweep) / 6)
    mid = { id, p, hIn: neg(tangent), hOut: tangent, mode: 'smooth' }
  } else {
    const third = scale(sub(b.p, a.p), 1 / 6)
    mid = { id, p, hIn: neg(third), hOut: third, mode: 'corner' }
  }
  const nodes = [...outline.nodes]
  const edges = [...outline.edges]
  nodes[index] = aNode
  nodes[(index + 1) % n] = bNode
  nodes.splice(index + 1, 0, mid)
  edges.splice(index, 1, edgeA, edgeB)
  return { outline: { nodes, edges }, id }
}

/** Remove an anchor; its two edges merge into one (keeping the first edge's kind). */
export function deleteNode(outline: Outline, id: string): Outline {
  const i = nodeIndex(outline, id)
  if (i < 0 || outline.nodes.length <= 2) return outline
  // Edge i (node i → i+1) goes away; edge i−1 now runs from node i−1 to node i+1
  return {
    nodes: outline.nodes.filter((_, k) => k !== i),
    edges: outline.edges.filter((_, k) => k !== i),
  }
}

/** Translate the whole outline (all anchors move; handles are relative so they follow). */
export function translateOutline(outline: Outline, d: Vec2): Outline {
  return { ...outline, nodes: outline.nodes.map((nd) => ({ ...nd, p: add(nd.p, d) })) }
}

/** The same closed outline traversed the other way (handles swap, arc bulges flip sign). */
export function reverseOutline(outline: Outline): Outline {
  const n = outline.nodes.length
  const nodes = [...outline.nodes].reverse().map((nd) => ({ ...nd, hIn: nd.hOut, hOut: nd.hIn }))
  // New edge i joins old nodes (n−1−i) → (n−2−i), i.e. old edge (n−2−i) reversed
  const edges = outline.nodes.map((_, i) => {
    const e = outline.edges[(((n - 2 - i) % n) + n) % n]
    return { ...e, bulge: -e.bulge }
  })
  return { nodes, edges }
}

/** Renumber so that node `start` becomes node 0 (shape unchanged). */
export function rotateOutline(outline: Outline, start: number): Outline {
  const n = outline.nodes.length
  const k = ((start % n) + n) % n
  return {
    nodes: [...outline.nodes.slice(k), ...outline.nodes.slice(0, k)],
    edges: [...outline.edges.slice(k), ...outline.edges.slice(0, k)],
  }
}

/**
 * The editing operations the foot editor uses. Free editing and mirrored editing (./mirror)
 * implement the same interface, so the UI only swaps which one it calls.
 */
export interface OutlineOps {
  moveNode(outline: Outline, id: string, p: Vec2): Outline
  moveHandle(outline: Outline, id: string, which: 'in' | 'out', offset: Vec2): Outline
  setNodeMode(outline: Outline, id: string, mode: NodeMode): Outline
  setEdgeKind(outline: Outline, index: number, kind: EdgeKind): Outline
  setEdgeBulge(outline: Outline, index: number, bulge: number): Outline
  insertNode(outline: Outline, index: number, t: number): { outline: Outline; id: string }
  deleteNode(outline: Outline, id: string): Outline
  canDelete(outline: Outline, id: string): boolean
  /** Anchors that must stay on the centreline (x locked) */
  isAxisNode(outline: Outline, id: string): boolean
}

export const freeOps: OutlineOps = {
  moveNode,
  moveHandle,
  setNodeMode,
  setEdgeKind,
  setEdgeBulge,
  insertNode,
  deleteNode,
  canDelete: (outline) => outline.nodes.length > 2,
  isAxisNode: () => false,
}
