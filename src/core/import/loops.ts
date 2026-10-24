import { flatten, orientCCW, pointInPolyline, signedArea } from '../curves/outline'
import { derivAt, endPoint, pointAt, reverseSegment, startPoint, type ArcSegment, type LineSegment, type Segment } from '../curves/segment'
import { TAU, wrapTau } from '../math/angle'
import { cross, distance, dot, fromAngle, normalize, perp, sub, type Vec2 } from '../math/vec2'
import { boundsOf, segmentLength, withEnds, type Bounds } from './segments'

// Separate DXF entities → closed loops, nested into parts and holes (SPEC §14.5).

/** Ends closer than this are the same point (CAD rounding), in mm */
export const JOIN_TOL = 0.002
/** Gaps up to this are closed without asking, in mm */
export const DEFAULT_GAP = 0.05
/** Open ends get a one-click fix when each has a partner within this, in mm */
const GAP_OFFER_LIMIT = 1

export interface Loop {
  /** Counter-clockwise closed chain */
  segments: Segment[]
  area: number
  polyline: Vec2[]
  bounds: Bounds
  /** Even = a part outline, odd = a hole in its parent */
  depth: number
  parent: number | null
}

export interface LoopSearch {
  /** Largest first */
  loops: Loop[]
  /** Open chains and lines inside an outline, which are left out */
  loose: Segment[]
  /** Lines dropped because they split an outline from the inside */
  internal: number
  /** Ends that still don't meet another end */
  openEnds: Vec2[]
  /** A gap tolerance that would close every open end, if each has a partner within 1 mm */
  suggestedGap: number | null
  gapsClosed: number
  largestGap: number
  duplicates: number
  merged: number
}

class UnionFind {
  private parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  union(i: number, j: number) {
    this.parent[this.find(i)] = this.find(j)
  }
}

/** Index pairs (i < j) of points within `tol`, by grid hashing. */
function nearPairs(points: Vec2[], tol: number): [number, number][] {
  const grid = new Map<string, number[]>()
  const cell = (p: Vec2) => [Math.floor(p.x / tol), Math.floor(p.y / tol)]
  points.forEach((p, i) => {
    const key = cell(p).join(',')
    const list = grid.get(key)
    if (list) list.push(i)
    else grid.set(key, [i])
  })
  const out: [number, number][] = []
  points.forEach((p, i) => {
    const [cx, cy] = cell(p)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (j > i && distance(p, points[j]) <= tol) out.push([i, j])
        }
      }
    }
  })
  return out
}

interface Merge {
  segments: Segment[]
  duplicates: number
  merged: number
}

/** Collinear lines that overlap become one line (their union); exact copies count as duplicates. */
function mergeLines(lines: { seg: LineSegment }[], out: Merge) {
  const info = lines.map(({ seg }) => {
    let theta = Math.atan2(seg.p1.y - seg.p0.y, seg.p1.x - seg.p0.x)
    if (theta < -1e-9) theta += Math.PI
    if (theta >= Math.PI - 1e-9) theta -= Math.PI
    const dir = fromAngle(theta)
    const n = perp(dir)
    const ends = [seg.p0, seg.p1].sort((a, b) => dot(a, dir) - dot(b, dir))
    return { seg, theta, rho: dot(n, seg.p0), lo: ends[0], hi: ends[1], s0: dot(ends[0], dir), s1: dot(ends[1], dir) }
  })
  info.sort((a, b) => a.theta - b.theta)
  const groups: (typeof info)[] = []
  for (const l of info) {
    const g = groups[groups.length - 1]
    if (g && l.theta - g[g.length - 1].theta < 1e-7) g.push(l)
    else groups.push([l])
  }
  for (const g of groups) {
    g.sort((a, b) => a.rho - b.rho)
    let start = 0
    for (let i = 1; i <= g.length; i++) {
      if (i < g.length && g[i].rho - g[i - 1].rho < JOIN_TOL) continue
      const run = g.slice(start, i).sort((a, b) => a.s0 - b.s0)
      start = i
      let cur = run[0]
      let touched = false
      const flush = () => {
        out.segments.push(touched ? { kind: 'line', p0: cur.lo, p1: cur.hi } : cur.seg)
      }
      for (const l of run.slice(1)) {
        if (l.s0 < cur.s1 - JOIN_TOL) {
          if (l.s1 <= cur.s1 + JOIN_TOL && l.s0 >= cur.s0 - JOIN_TOL) out.duplicates++
          else out.merged++
          if (l.s1 > cur.s1) cur = { ...cur, hi: l.hi, s1: l.s1 }
          touched = true
        } else {
          flush()
          cur = l
          touched = false
        }
      }
      flush()
    }
  }
}

/** Arcs of one circle that overlap become one arc (their union). */
function mergeArcs(arcs: ArcSegment[], out: Merge) {
  const norm = arcs.map((a) => {
    const start = wrapTau(a.sweep < 0 ? a.startAngle + a.sweep : a.startAngle)
    return { arc: a, a0: start, a1: start + Math.abs(a.sweep) }
  })
  norm.sort((a, b) => a.arc.radius - b.arc.radius)
  const circles: (typeof norm)[] = []
  for (const n of norm) {
    // Sorted by radius, so only the most recent circles can match
    let c: (typeof norm) | undefined
    for (let k = circles.length - 1; k >= 0 && n.arc.radius - circles[k][0].arc.radius < JOIN_TOL; k--) {
      if (distance(circles[k][0].arc.center, n.arc.center) < JOIN_TOL) {
        c = circles[k]
        break
      }
    }
    if (c) c.push(n)
    else circles.push([n])
  }
  for (const g of circles) {
    if (g.length === 1) {
      out.segments.push(g[0].arc)
      continue
    }
    const tol = JOIN_TOL / g[0].arc.radius
    g.sort((a, b) => a.a0 - b.a0)
    const spans: { a0: number; a1: number; arcs: ArcSegment[] }[] = []
    for (const n of g) {
      const last = spans[spans.length - 1]
      if (last && n.a0 < last.a1 - tol) {
        if (n.a1 <= last.a1 + tol) out.duplicates++
        else out.merged++
        last.a1 = Math.max(last.a1, n.a1)
        last.arcs.push(n.arc)
      } else {
        spans.push({ a0: n.a0, a1: n.a1, arcs: [n.arc] })
      }
    }
    // An overlap across 0°
    const first = spans[0]
    const last = spans[spans.length - 1]
    if (spans.length > 1 && last.a1 - TAU > first.a0 + tol) {
      if (last.a1 - TAU >= first.a1 - tol) out.duplicates++
      else out.merged++
      first.a0 = last.a0 - TAU
      first.a1 = Math.max(first.a1, last.a1 - TAU)
      first.arcs.push(...last.arcs)
      spans.pop()
    }
    const { center, radius } = g[0].arc
    for (const s of spans) {
      if (s.arcs.length === 1) {
        out.segments.push(s.arcs[0])
      } else if (s.a1 - s.a0 >= TAU - tol) {
        out.segments.push(
          { kind: 'arc', center, radius, startAngle: 0, sweep: Math.PI },
          { kind: 'arc', center, radius, startAngle: Math.PI, sweep: Math.PI },
        )
      } else {
        out.segments.push({ kind: 'arc', center, radius, startAngle: s.a0, sweep: s.a1 - s.a0 })
      }
    }
  }
}

/** Remove duplicated entities and merge overlapping lines and arcs: both are common in laser and CAM files. */
export function mergeOverlaps(segments: Segment[]): Merge {
  const out: Merge = { segments: [], duplicates: 0, merged: 0 }
  const lines: { seg: LineSegment }[] = []
  const arcs: ArcSegment[] = []
  const cubics = new Map<string, Segment>()
  const key = (pts: Vec2[]) => pts.map((p) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`).join(';')
  for (const seg of segments) {
    if (seg.kind === 'line') lines.push({ seg })
    else if (seg.kind === 'arc') arcs.push(seg)
    else {
      const fwd = key([seg.p0, seg.p1, seg.p2, seg.p3])
      const rev = key([seg.p3, seg.p2, seg.p1, seg.p0])
      const k = fwd < rev ? fwd : rev
      if (cubics.has(k)) out.duplicates++
      else cubics.set(k, seg)
    }
  }
  mergeLines(lines, out)
  mergeArcs(arcs, out)
  out.segments.push(...cubics.values())
  return out
}

interface Edge {
  seg: Segment
  a: number
  b: number
}

/** Traversal of one edge in one direction */
interface Step {
  e: number
  fwd: boolean
}

const DIR_STEP = 1e-3

/** Unit direction of travel leaving a segment's start (a short chord, so tangent curves still differ). */
const leaving = (seg: Segment): Vec2 => normalize(sub(pointAt(seg, DIR_STEP), startPoint(seg)))
const arriving = (seg: Segment): Vec2 => normalize(sub(endPoint(seg), pointAt(seg, 1 - DIR_STEP)))

/**
 * Outer boundary of one connected group of edges, counter-clockwise: start at its leftmost point
 * heading down, and at every junction take the rightmost turn, which keeps to the outside.
 */
function traceOuter(ids: number[], edges: Edge[], adj: number[][], alive: boolean[]): { chain: Segment[]; used: Set<number> } | null {
  const oriented = (s: Step): Segment => (s.fwd ? edges[s.e].seg : reverseSegment(edges[s.e].seg))
  const from = (s: Step) => (s.fwd ? edges[s.e].a : edges[s.e].b)
  const to = (s: Step) => (s.fwd ? edges[s.e].b : edges[s.e].a)

  let best = { x: Infinity, y: Infinity, e: -1, t: 0 }
  for (const e of ids) {
    for (let k = 0; k <= 32; k++) {
      const p = pointAt(edges[e].seg, k / 32)
      if (p.x < best.x - 1e-9 || (Math.abs(p.x - best.x) <= 1e-9 && p.y < best.y)) best = { x: p.x, y: p.y, e, t: k / 32 }
    }
  }
  const choose = (v: number, dIn: Vec2, exclude: Step | null): Step | null => {
    let pick: Step | null = null
    let pickTurn = Infinity
    for (const e of adj[v]) {
      if (!alive[e]) continue
      for (const fwd of [true, false]) {
        const s = { e, fwd }
        if (from(s) !== v || (exclude && exclude.e === e && exclude.fwd !== fwd)) continue
        const d = leaving(oriented(s))
        const turn = Math.atan2(cross(dIn, d), dot(dIn, d))
        if (turn < pickTurn) {
          pickTurn = turn
          pick = s
        }
      }
    }
    return pick
  }
  let start: Step | null
  if (best.t > 0 && best.t < 1) {
    start = { e: best.e, fwd: derivAt(edges[best.e].seg, best.t).y <= 0 }
  } else {
    const v = best.t === 0 ? edges[best.e].a : edges[best.e].b
    start = choose(v, { x: 0, y: -1 }, null)
  }
  if (!start) return null
  const chain: Segment[] = []
  const used = new Set<number>()
  let s = start
  for (let step = 0; step <= 2 * ids.length + 2; step++) {
    const seg = oriented(s)
    chain.push(seg)
    used.add(s.e)
    const next = choose(to(s), arriving(seg), s)
    if (!next) return null
    if (next.e === start.e && next.fwd === start.fwd) return { chain, used }
    s = next
  }
  return null
}

/** Closed loops from loose segments: joins ends, closes small gaps, prunes open chains and nests the loops. */
export function findLoops(input: Segment[], gap = DEFAULT_GAP): LoopSearch {
  const { segments, duplicates, merged } = mergeOverlaps(input.filter((s) => segmentLength(s) >= JOIN_TOL))
  const ends = segments.flatMap((s) => [startPoint(s), endPoint(s)])
  const uf = new UnionFind(ends.length)
  for (const [i, j] of nearPairs(ends, JOIN_TOL)) uf.union(i, j)

  const degree = new Map<number, number>()
  for (let i = 0; i < ends.length; i++) degree.set(uf.find(i), (degree.get(uf.find(i)) ?? 0) + 1)
  const openIndex = () => ends.map((_, i) => i).filter((i) => degree.get(uf.find(i)) === 1)
  // Two ends of one line never close onto each other
  const sameLine = (i: number, j: number) => i >> 1 === j >> 1 && segments[i >> 1].kind === 'line'

  // Close gaps, nearest first, each end at most once
  let gapsClosed = 0
  let largestGap = 0
  const open = openIndex()
  const candidates = nearPairs(open.map((i) => ends[i]), Math.max(gap, JOIN_TOL))
    .map(([a, b]) => ({ i: open[a], j: open[b], d: distance(ends[open[a]], ends[open[b]]) }))
    .filter((c) => !sameLine(c.i, c.j))
    .sort((a, b) => a.d - b.d)
  const closed = new Set<number>()
  for (const c of candidates) {
    if (closed.has(c.i) || closed.has(c.j)) continue
    closed.add(c.i)
    closed.add(c.j)
    uf.union(c.i, c.j)
    degree.set(uf.find(c.i), 2)
    gapsClosed++
    largestGap = Math.max(largestGap, c.d)
  }
  const stillOpen = open.filter((i) => !closed.has(i))
  let suggestedGap: number | null = null
  if (stillOpen.length > 0 && stillOpen.length <= 2000) {
    const nearest = stillOpen.map((i) =>
      stillOpen.reduce((m, j) => (j === i || sameLine(i, j) ? m : Math.min(m, distance(ends[i], ends[j]))), Infinity),
    )
    const worst = nearest.reduce((m, d) => Math.max(m, d), 0)
    if (worst <= GAP_OFFER_LIMIT) suggestedGap = Math.ceil(worst * 100 + 1e-9) / 100
  }

  // Vertices at the mean of their ends
  const ids = new Map<number, number>()
  const sums: { x: number; y: number; n: number }[] = []
  const vertexOf = (i: number) => {
    const root = uf.find(i)
    let v = ids.get(root)
    if (v === undefined) {
      v = sums.length
      ids.set(root, v)
      sums.push({ x: 0, y: 0, n: 0 })
    }
    return v
  }
  ends.forEach((p, i) => {
    const s = sums[vertexOf(i)]
    s.x += p.x
    s.y += p.y
    s.n++
  })
  const pos = sums.map((s) => ({ x: s.x / s.n, y: s.y / s.n }))
  const edges: Edge[] = segments.map((seg, k) => {
    const a = vertexOf(2 * k)
    const b = vertexOf(2 * k + 1)
    return { seg: withEnds(seg, pos[a], pos[b]), a, b }
  })

  // Prune open chains from their free ends
  const adj: number[][] = pos.map(() => [])
  edges.forEach((e, k) => {
    adj[e.a].push(k)
    adj[e.b].push(k)
  })
  const alive = edges.map(() => true)
  const deg = adj.map((list) => list.length)
  const queue = deg.flatMap((d, v) => (d === 1 ? [v] : []))
  const loose: Segment[] = []
  while (queue.length > 0) {
    const v = queue.pop()!
    if (deg[v] !== 1) continue
    const k = adj[v].find((e) => alive[e])
    if (k === undefined) continue
    alive[k] = false
    loose.push(edges[k].seg)
    for (const w of [edges[k].a, edges[k].b]) {
      deg[w]--
      if (deg[w] === 1) queue.push(w)
    }
  }

  // Outer boundary of each connected group
  const groups = new UnionFind(pos.length)
  edges.forEach((e, k) => alive[k] && groups.union(e.a, e.b))
  const byGroup = new Map<number, number[]>()
  edges.forEach((e, k) => {
    if (!alive[k]) return
    const g = groups.find(e.a)
    const list = byGroup.get(g)
    if (list) list.push(k)
    else byGroup.set(g, [k])
  })
  const chains: Segment[][] = []
  let internal = 0
  for (const list of byGroup.values()) {
    const traced = traceOuter(list, edges, adj, alive)
    if (!traced) {
      loose.push(...list.map((k) => edges[k].seg))
      continue
    }
    for (const k of list) {
      if (traced.used.has(k)) continue
      internal++
      loose.push(edges[k].seg)
    }
    if (Math.abs(signedArea(traced.chain)) > 1e-9) chains.push(orientCCW(traced.chain))
  }

  // Nest by containment: the smallest loop around each one is its parent
  const loops: Loop[] = chains
    .map((chain) => ({
      segments: chain,
      area: Math.abs(signedArea(chain)),
      polyline: flatten(chain, 24),
      bounds: boundsOf(chain),
      depth: 0,
      parent: null as number | null,
    }))
    .sort((a, b) => b.area - a.area)
  loops.forEach((loop, i) => {
    const probe = pointAt(loop.segments[0], 0.5)
    for (let j = i - 1; j >= 0; j--) {
      const b = loops[j].bounds
      if (probe.x < b.min.x || probe.x > b.max.x || probe.y < b.min.y || probe.y > b.max.y) continue
      if (pointInPolyline(probe, loops[j].polyline)) {
        loop.parent = j
        loop.depth = loops[j].depth + 1
        break
      }
    }
  })

  return {
    loops,
    loose,
    internal,
    openEnds: stillOpen.map((i) => pos[vertexOf(i)]),
    suggestedGap,
    gapsClosed,
    largestGap,
    duplicates,
    merged,
  }
}
