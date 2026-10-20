import { TAU, wrapTau } from '../math/angle'
import { integrate } from '../math/quadrature'
import { brent, rootsOnInterval } from '../math/roots'
import { fitCurve1D, type Curve1D } from '../spline/curve'
import type { FootEvent } from './events'
import type { FootModel } from './foot'
import { CURVE_TOL, smoothIntervals } from './footCurves'

/** Part of the cycle during which `foot` is the lowest (stance) foot. */
export interface EnvelopeSpan {
  phi0: number
  phi1: number
  foot: number
}

/** Smooth piece of the envelope: one stance foot and one support owner. */
export interface EnvelopePiece {
  a: number
  b: number
  foot: number
  piece: number
}

export interface Handoff {
  phi: number
  from: number
  to: number
  /** Slope jump of the envelope, y′_out − y′_in ≥ 0 (mm/rad) */
  kinkY: number
  /** |v_out − v_in| at the handoff (mm/rad) */
  slipX: number
}

/** Lower envelope E(φ) over one period Δ = 2π/N, starting at a handoff (SPEC §6). */
export interface Envelope {
  period: number
  start: number
  spans: EnvelopeSpan[]
  pieces: EnvelopePiece[]
  handoffs: Handoff[]
  height: Curve1D
  speed: Curve1D
  minY: number
  maxY: number
  /** Signed body travel over one period (∫ v dφ) */
  stepTravel: number
  minV: number
  maxV: number
  peakYDD: number
  /** Fraction of the cycle with a second foot within DOUBLE_SUPPORT_TOL of the stance foot */
  doubleSupport: number
}

const GRID = 240
const DOUBLE_SUPPORT_TOL = 0.01

/** Height and index of the lowest foot at φ. */
export function lowestFoot(model: FootModel, feet: number, phi: number): { y: number; foot: number } {
  const period = TAU / feet
  let best = Infinity
  let foot = 0
  for (let k = 0; k < feet; k++) {
    const y = model.sample(phi + k * period).y
    if (y < best) {
      best = y
      foot = k
    }
  }
  return { y: best, foot }
}

export function computeEnvelope(model: FootModel, events: FootEvent[], feet: number, tol = CURVE_TOL): Envelope {
  const period = TAU / feet
  const yOf = (phi: number, k: number) => model.sample(phi + k * period).y

  // Grid over [0, Δ] refined with every foot's events
  const grid: number[] = []
  for (let i = 0; i <= GRID; i++) grid.push((period * i) / GRID)
  for (const e of events) {
    for (let k = 0; k < feet; k++) {
      const p = wrapTau(e.phi - k * period)
      if (p < period) grid.push(p)
    }
  }
  grid.sort((a, b) => a - b)
  const winners = grid.map((p) => lowestFoot(model, feet, p).foot)

  const switches: { phi: number; from: number; to: number }[] = []
  for (let i = 0; i + 1 < grid.length; i++) {
    const a = winners[i]
    const b = winners[i + 1]
    if (a === b || grid[i + 1] - grid[i] <= 0) continue
    const phi = brent((p) => yOf(p, a) - yOf(p, b), grid[i], grid[i + 1])
    if (phi >= period) continue
    switches.push({ phi, from: a, to: b })
  }
  if (switches.length === 0) switches.push({ phi: 0, from: winners[0], to: winners[0] })

  const start = switches[0].phi
  const spans: EnvelopeSpan[] = switches.map((s, i) => ({
    phi0: s.phi,
    phi1: i + 1 < switches.length ? switches[i + 1].phi : start + period,
    foot: s.to,
  }))

  const eps = 1e-9
  const handoffs: Handoff[] = feet > 1
    ? switches.map((s) => {
      const out = model.sample(s.phi + s.from * period, model.pieceAt(s.phi - eps + s.from * period))
      const inn = model.sample(s.phi + s.to * period, model.pieceAt(s.phi + eps + s.to * period))
      return { phi: s.phi, from: s.from, to: s.to, kinkY: out.yD - inn.yD, slipX: Math.abs(out.v - inn.v) }
    })
    : []

  const pieces: EnvelopePiece[] = []
  for (const span of spans) {
    for (const iv of smoothIntervals(events, span.phi0, span.phi1, span.foot * period)) {
      const piece = model.pieceAt((iv.a + iv.b) / 2 + span.foot * period)
      pieces.push({ a: iv.a, b: iv.b, foot: span.foot, piece })
    }
  }

  const height: Curve1D = { pieces: [] }
  const speed: Curve1D = { pieces: [] }
  let minY = Infinity
  let maxY = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  let stepTravel = 0
  let peakYDD = 0
  let doubleSupport = 0
  for (const pc of pieces) {
    const shift = pc.foot * period
    const s = (phi: number) => model.sample(phi + shift, pc.piece)
    height.pieces.push(...fitCurve1D((phi) => { const x = s(phi); return { v: x.y, d: x.yD } }, pc.a, pc.b, tol))
    speed.pieces.push(...fitCurve1D((phi) => { const x = s(phi); return { v: x.v, d: x.vD } }, pc.a, pc.b, tol))

    const yCandidates = [pc.a, pc.b, ...rootsOnInterval((phi) => s(phi).yD, pc.a, pc.b, 16)]
    for (const phi of yCandidates) {
      const y = s(phi).y
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    const vCandidates = [pc.a, pc.b, ...rootsOnInterval((phi) => s(phi).vD, pc.a, pc.b, 16)]
    for (const phi of vCandidates) {
      const v = s(phi).v
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    stepTravel += integrate((phi) => s(phi).v, pc.a, pc.b, 2)

    const checks = 24
    let close = 0
    for (let i = 0; i <= checks; i++) {
      const phi = pc.a + ((pc.b - pc.a) * i) / checks
      const x = s(phi)
      peakYDD = Math.max(peakYDD, Math.abs(x.yDD))
      for (let k = 0; k < feet; k++) {
        if (k === pc.foot) continue
        if (yOf(phi, k) - x.y < DOUBLE_SUPPORT_TOL) {
          close++
          break
        }
      }
    }
    doubleSupport += ((pc.b - pc.a) * close) / (checks + 1)
  }

  return {
    period,
    start,
    spans,
    pieces,
    handoffs,
    height,
    speed,
    minY,
    maxY,
    stepTravel,
    minV,
    maxV,
    peakYDD,
    doubleSupport: doubleSupport / period,
  }
}
