import { TAU, wrapPi } from '../math/angle'
import { brent } from '../math/roots'
import { distance, type Vec2 } from '../math/vec2'
import type { ContactPiece, SupportPoint } from './contactPieces'
import { subSegment, type Segment } from './segment'

/** A change of support owner at normal angle psi. `continuous` is false where the contact point jumps (a hull bridge). */
export interface SupportBreak {
  psi: number
  from: number
  to: number
  continuous: boolean
}

/**
 * Partition of all directions ψ ∈ [−π, π) by which contact piece supports the outline.
 * Lookups are a binary search plus one closed-form evaluation.
 */
export interface SupportMap {
  pieces: ContactPiece[]
  /** Sorted interval start angles in [−π, π) and their owning piece; interval i ends where i + 1 starts (cyclic). */
  starts: number[]
  owners: number[]
  breaks: SupportBreak[]
  pieceAt(psi: number): number
  evaluate(psi: number, piece?: number): SupportPoint & { piece: number }
}

const SAMPLES = 512

/** Distance under which two support points count as the same contact (mm). */
const CONTINUITY_TOL = 1e-6

/**
 * Where a switch happens at the exact end of one piece's normal range (a smooth junction or a corner),
 * return that boundary. Root-finding there is ill-conditioned because the two supports touch tangentially.
 */
function sharedBoundary(a: ContactPiece, b: ContactPiece, lo: number, hi: number): number | null {
  const inBracket = (psi: number) => {
    const u = lo + ((((psi - lo) % TAU) + TAU) % TAU)
    return u <= hi + 1e-12 ? u : null
  }
  const endA = a.kind === 'point' ? null : a.psiStart + a.psiSpan
  const startB = b.kind === 'point' ? null : b.psiStart
  let candidate: number | null = null
  if (endA !== null && startB !== null) candidate = Math.abs(wrapPi(endA - startB)) < 1e-9 ? inBracket(endA) : null
  else if (endA !== null) candidate = inBracket(endA)
  else if (startB !== null) candidate = inBracket(startB)
  if (candidate === null) return null
  // Only a real meeting point: both pieces must put the contact at the same place there
  return distance(a.support(candidate).q, b.support(candidate).q) < 1e-9 ? candidate : null
}

function winner(pieces: ContactPiece[], psi: number): number {
  let best = -1
  let bestH = -Infinity
  let bestPriority = -1
  const values = pieces.map((p) => p.support(psi).h)
  const maxH = Math.max(...values)
  const tol = 1e-10 * (1 + Math.abs(maxH))
  for (let i = 0; i < pieces.length; i++) {
    if (values[i] < maxH - tol) continue
    const p = pieces[i]
    const priority = p.kind === 'point' ? 1 : p.inRange(psi) ? 2 : 0
    if (priority > bestPriority || (priority === bestPriority && values[i] > bestH + tol)) {
      best = i
      bestH = values[i]
      bestPriority = priority
    }
  }
  return best
}

export function buildSupportMap(pieces: ContactPiece[]): SupportMap {
  const raw: number[] = []
  for (let i = 0; i < SAMPLES; i++) raw.push(-Math.PI + (TAU * i) / SAMPLES)
  for (const p of pieces) {
    if (p.kind === 'point') continue
    raw.push(wrapPi(p.psiStart), wrapPi(p.psiStart + p.psiSpan))
  }
  raw.sort((a, b) => a - b)
  const samples: number[] = []
  for (const s of raw) if (samples.length === 0 || s - samples[samples.length - 1] > 1e-12) samples.push(s)

  const winners = samples.map((s) => winner(pieces, s))
  const switches: { psi: number; from: number; to: number }[] = []
  for (let i = 0; i < samples.length; i++) {
    const j = (i + 1) % samples.length
    const a = winners[i]
    const b = winners[j]
    if (a === b) continue
    const lo = samples[i]
    const hi = j === 0 ? samples[0] + TAU : samples[j]
    const snapped = sharedBoundary(pieces[a], pieces[b], lo, hi)
    const g = (psi: number) => pieces[a].support(psi).h - pieces[b].support(psi).h
    switches.push({ psi: wrapPi(snapped ?? brent(g, lo, hi, 1e-14)), from: a, to: b })
  }

  let starts: number[]
  let owners: number[]
  if (switches.length === 0) {
    starts = [-Math.PI]
    owners = [winners[0]]
  } else {
    switches.sort((p, q) => p.psi - q.psi)
    starts = switches.map((s) => s.psi)
    owners = switches.map((s) => s.to)
  }

  const breaks: SupportBreak[] = switches.map((s) => {
    const qa = pieces[s.from].support(s.psi).q
    const qb = pieces[s.to].support(s.psi).q
    return { ...s, continuous: distance(qa, qb) < CONTINUITY_TOL }
  })

  const pieceAt = (psi: number): number => {
    const w = wrapPi(psi)
    let lo = 0
    let hi = starts.length - 1
    if (w < starts[0]) return owners[owners.length - 1]
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= w) lo = mid
      else hi = mid - 1
    }
    return owners[lo]
  }

  return {
    pieces,
    starts,
    owners,
    breaks,
    pieceAt,
    evaluate(psi, piece) {
      const index = piece ?? pieceAt(psi)
      return { ...pieces[index].support(psi), piece: index }
    },
  }
}

/**
 * The part of the convex hull that supports directions in [psiA, psiB] (CCW, psiB ≥ psiA),
 * as an open chain of segments in the foot frame. Hull bridges are returned as straight lines.
 */
export function hullFragments(map: SupportMap, segments: Segment[], psiA: number, psiB: number): Segment[] {
  const span = Math.min(psiB - psiA, TAU)
  if (span <= 0) return []
  // Cut points inside (psiA, psiA + span): every interval start, unwrapped relative to psiA
  const cuts = map.starts
    .map((s) => psiA + ((((s - psiA) % TAU) + TAU) % TAU))
    .filter((s) => s > psiA && s < psiA + span)
    .sort((a, b) => a - b)
  const bounds = [psiA, ...cuts, psiA + span]
  const out: Segment[] = []
  let last: Vec2 | null = null
  for (let i = 0; i + 1 < bounds.length; i++) {
    const u = bounds[i]
    const v = bounds[i + 1]
    const piece = map.pieceAt((u + v) / 2)
    const p = map.pieces[piece]
    const start = p.support(u).q
    if (last && distance(last, start) > 1e-9) out.push({ kind: 'line', p0: last, p1: start })
    if (p.kind !== 'point') {
      const seg = segments[p.segIndex]
      const t0 = p.paramAt(u)
      const t1 = p.paramAt(v)
      if (t1 > t0) out.push(subSegment(seg, t0, t1))
    }
    last = p.support(v).q
  }
  return out
}
