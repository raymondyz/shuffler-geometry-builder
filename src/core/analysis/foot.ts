import type { SupportMap } from '../curves/supportMap'
import type { TiltConstraint } from '../mechanism/constraints/types'
import type { Drive } from '../mechanism/drive'
import type { Vec2 } from '../math/vec2'

/** Everything about one foot at one cam angle, in the body frame (SPEC §4–§7). */
export interface FootSample {
  phi: number
  p1: Vec2
  alpha: number
  alphaD: number
  alphaDD: number
  /** Foot-frame direction of "down": ψ = −π/2 − α */
  psi: number
  /** Index of the support-map piece that owns the contact */
  piece: number
  /** Height of P1 above the contact (support value), its ψ-derivative, and contact radius of curvature */
  h: number
  hd: number
  rho: number
  /** Contact point in the foot frame and the body frame */
  qLocal: Vec2
  contact: Vec2
  contactD: Vec2
  /** Height of the lowest point and its derivatives */
  y: number
  yD: number
  yDD: number
  /** No-slip body travel per radian of cam, dX/dφ, and its derivative */
  v: number
  vD: number
}

export interface FootModel {
  drive: Drive
  constraint: TiltConstraint
  supportMap: SupportMap
  /** Evaluate at φ; `piece` forces a support owner (used for exact one-sided values at events). */
  sample(phi: number, piece?: number): FootSample
  pieceAt(phi: number): number
}

export function createFootModel(drive: Drive, constraint: TiltConstraint, supportMap: SupportMap): FootModel {
  const sample = (phi: number, piece?: number): FootSample => {
    const p1 = drive.p1(phi)
    const p1d = drive.p1d(phi)
    const p1dd = drive.p1dd(phi)
    const { alpha, d1: alphaD, d2: alphaDD } = constraint.tilt(phi)
    const psi = -Math.PI / 2 - alpha
    const s = supportMap.evaluate(psi, piece)
    const { h, hd, rho } = s
    return {
      phi,
      p1,
      alpha,
      alphaD,
      alphaDD,
      psi,
      piece: s.piece,
      h,
      hd,
      rho,
      qLocal: s.q,
      contact: { x: p1.x + hd, y: p1.y - h },
      contactD: { x: p1d.x + alphaD * (h - rho), y: p1d.y + hd * alphaD },
      y: p1.y - h,
      yD: p1d.y + hd * alphaD,
      yDD: p1dd.y - (rho - h) * alphaD * alphaD + hd * alphaDD,
      v: -(p1d.x + alphaD * h),
      vD: -(p1dd.x + alphaDD * h - alphaD * alphaD * hd),
    }
  }
  const pieceAt = (phi: number) => supportMap.pieceAt(-Math.PI / 2 - constraint.tilt(phi).alpha)
  return { drive, constraint, supportMap, sample, pieceAt }
}
