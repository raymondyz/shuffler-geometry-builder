import { TAU, wrapPi, wrapTau } from '../math/angle'
import { brent, rootsOnInterval } from '../math/roots'
import type { FootModel } from './foot'

export type FootEventKind = 'tiltExtremum' | 'contactSmooth' | 'contactJump'

/** A cam angle where the per-foot functions are not jointly smooth (SPEC §11.5). */
export interface FootEvent {
  phi: number
  kind: FootEventKind
}

/** Tilt extrema from the constraint, or found numerically if it does not provide them. */
function tiltExtrema(model: FootModel): number[] {
  const exact = model.constraint.tiltExtrema()
  if (exact.length > 0) return exact
  return rootsOnInterval((phi) => model.constraint.tilt(phi).d1, 0, TAU, 360).map(wrapTau)
}

/** All events of foot 0 over one revolution, sorted in [0, 2π). */
export function findFootEvents(model: FootModel): FootEvent[] {
  const events: FootEvent[] = []
  const extrema = tiltExtrema(model)
  for (const phi of extrema) events.push({ phi, kind: 'tiltExtremum' })

  // Monotone-α intervals between consecutive extrema (cyclic)
  const bounds = extrema.length > 0 ? extrema : [0]
  const intervals: [number, number][] = bounds.map((a, i) => {
    const b = i + 1 < bounds.length ? bounds[i + 1] : bounds[0] + TAU
    return [a, b]
  })

  const alpha = (phi: number) => model.constraint.tilt(phi).alpha
  for (const brk of model.supportMap.breaks) {
    const kind: FootEventKind = brk.continuous ? 'contactSmooth' : 'contactJump'
    for (const [a, b] of intervals) {
      const alphaA = alpha(a)
      const alphaB = alpha(b)
      // Target tilt, unwrapped next to this interval's tilt values
      const target = alphaA + wrapPi(-Math.PI / 2 - brk.psi - alphaA)
      const lo = Math.min(alphaA, alphaB)
      const hi = Math.max(alphaA, alphaB)
      if (target <= lo || target >= hi) continue
      const phi = brent((p) => alpha(p) - target, a, b)
      events.push({ phi: wrapTau(phi), kind })
    }
  }

  events.sort((p, q) => p.phi - q.phi)
  return events.filter((e, i) => i === 0 || e.phi - events[i - 1].phi > 1e-11)
}
