import { TAU } from '../math/angle'
import { distance, type Vec2 } from '../math/vec2'
import type { CubicBezier } from '../spline/curve'
import { endPoint, pointAt, startPoint, type Segment } from './segment'

// SVG path data in the math coordinate system (y up). Callers flip y with a transform.
// Arc sweep flags are interpreted in the path's own user space, so CCW (math) is sweep-flag 1.

const f = (v: number): string => {
  const r = Math.round(v * 1e4) / 1e4
  return Object.is(r, -0) ? '0' : String(r)
}

const pt = (p: Vec2): string => `${f(p.x)} ${f(p.y)}`

function arcCommands(seg: Extract<Segment, { kind: 'arc' }>): string {
  // SVG arcs cannot describe a full circle in one command, so split long sweeps in two
  const parts = Math.abs(seg.sweep) > TAU * 0.75 ? 2 : 1
  let out = ''
  for (let i = 1; i <= parts; i++) {
    const end = pointAt(seg, i / parts)
    const sweep = seg.sweep / parts
    out += ` A ${f(seg.radius)} ${f(seg.radius)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${pt(end)}`
  }
  return out
}

function segmentCommands(seg: Segment): string {
  switch (seg.kind) {
    case 'line':
      return ` L ${pt(seg.p1)}`
    case 'arc':
      return arcCommands(seg)
    case 'cubic':
      return ` C ${pt(seg.p1)} ${pt(seg.p2)} ${pt(seg.p3)}`
  }
}

/** Path data for a chain of segments; starts a new subpath wherever the chain is discontinuous. */
export function segmentsToPath(segments: Segment[], closed = false): string {
  let d = ''
  let last: Vec2 | null = null
  for (const seg of segments) {
    const s = startPoint(seg)
    if (!last || distance(last, s) > 1e-6) d += `${d ? ' ' : ''}M ${pt(s)}`
    d += segmentCommands(seg)
    last = endPoint(seg)
  }
  return closed && d ? `${d} Z` : d
}

/** Path data for cubic Béziers; starts a new subpath wherever consecutive pieces do not touch. */
export function beziersToPath(beziers: CubicBezier[], gap = 1e-6): string {
  let d = ''
  let last: Vec2 | null = null
  for (const b of beziers) {
    if (!last || distance(last, b.p0) > gap) d += `${d ? ' ' : ''}M ${pt(b.p0)}`
    d += ` C ${pt(b.p1)} ${pt(b.p2)} ${pt(b.p3)}`
    last = b.p3
  }
  return d
}
