import type { Vec2 } from '../math/vec2'

// 8-point Gauss–Legendre on [−1, 1]
const GL_X = [-0.9602898564975363, -0.796666477413627, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.796666477413627, 0.9602898564975363]
const GL_W = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763]

/** Uniform cubic B-spline weights of the four basis functions active at local parameter u ∈ [0, 1]. */
function bsplineWeights(u: number): [number, number, number, number] {
  const v = 1 - u
  return [(v * v * v) / 6, (3 * u * u * u - 6 * u * u + 4) / 6, (-3 * u * u * u + 3 * u * u + 3 * u + 1) / 6, (u * u * u) / 6]
}

export interface ProfileWeights {
  /** Weights of h(ψ), h′(ψ) and ρ(ψ) over the profile variables [a, b, c₀ … c_{K−1}] */
  h: Float64Array
  hd: Float64Array
  rho: Float64Array
}

/**
 * Convex contact profile described by its radius of curvature (SPEC §10.4):
 *   ρ(ψ) = Σ c_j B_j(ψ)  (uniform cubic B-spline over [lo, hi])
 *   h(ψ) = a cos ψ + b sin ψ + ∫_ψ0^ψ ρ(t) sin(ψ − t) dt,  ψ0 = the middle of the band
 * so h + h″ = ρ exactly, and c_j ≥ ρ_min bounds the radius everywhere. Integrating from the middle
 * makes a band centred on −π/2 with symmetric c_j and a = 0 give a mirror-symmetric profile. Every
 * quantity is linear in the variables [a, b, c₀ … c_{K−1}].
 */
export interface Profile {
  lo: number
  hi: number
  /** Number of B-spline coefficients */
  count: number
  /** Number of variables: 2 + count */
  size: number
  weights(psi: number): ProfileWeights
}

export function createProfile(lo: number, hi: number, count = 16): Profile {
  const intervals = count - 3
  const span = (hi - lo) / intervals
  const size = 2 + count
  // ∫ B_j(t) cos t dt and ∫ B_j(t) sin t dt from lo to each knot
  const cumC: Float64Array[] = [new Float64Array(count)]
  const cumS: Float64Array[] = [new Float64Array(count)]

  /** Adds ∫ over [t0, t1] (inside interval i) of B_j cos t and B_j sin t to c and s */
  const partial = (i: number, t0: number, t1: number, c: Float64Array, s: Float64Array) => {
    const half = (t1 - t0) / 2
    const mid = (t0 + t1) / 2
    for (let g = 0; g < 8; g++) {
      const t = mid + half * GL_X[g]
      const w = GL_W[g] * half
      const b = bsplineWeights((t - lo) / span - i)
      const ct = Math.cos(t) * w
      const st = Math.sin(t) * w
      for (let k = 0; k < 4; k++) {
        c[i + k] += b[k] * ct
        s[i + k] += b[k] * st
      }
    }
  }

  for (let i = 0; i < intervals; i++) {
    const c = new Float64Array(cumC[i])
    const s = new Float64Array(cumS[i])
    partial(i, lo + i * span, lo + (i + 1) * span, c, s)
    cumC.push(c)
    cumS.push(s)
  }

  /** ∫ from lo to ψ of B_j cos t and B_j sin t */
  const fromLo = (psi: number) => {
    const i = Math.min(intervals - 1, Math.max(0, Math.floor((psi - lo) / span)))
    const c = new Float64Array(cumC[i])
    const s = new Float64Array(cumS[i])
    partial(i, lo + i * span, psi, c, s)
    return { i, c, s }
  }
  const mid = fromLo((lo + hi) / 2)

  const weights = (psiIn: number): ProfileWeights => {
    const psi = Math.min(hi, Math.max(lo, psiIn))
    const { i, c, s } = fromLo(psi)
    for (let j = 0; j < count; j++) {
      c[j] -= mid.c[j]
      s[j] -= mid.s[j]
    }
    const cp = Math.cos(psi)
    const sp = Math.sin(psi)
    const h = new Float64Array(size)
    const hd = new Float64Array(size)
    const rho = new Float64Array(size)
    h[0] = cp
    h[1] = sp
    hd[0] = -sp
    hd[1] = cp
    // sin(ψ − t) = sin ψ cos t − cos ψ sin t ; its ψ-derivative uses cos(ψ − t)
    for (let j = 0; j < count; j++) {
      h[2 + j] = sp * c[j] - cp * s[j]
      hd[2 + j] = cp * c[j] + sp * s[j]
    }
    const b = bsplineWeights((psi - lo) / span - i)
    for (let k = 0; k < 4; k++) rho[2 + i + k] = b[k]
    return { h, hd, rho }
  }

  return { lo, hi, count, size, weights }
}

const dotw = (w: Float64Array, x: ArrayLike<number>, offset: number) => {
  let v = 0
  for (let i = 0; i < w.length; i++) v += w[i] * x[offset + i]
  return v
}

/** Values of h, h′, ρ and the contact point q = h n + h′ n′ for solved variables x (profile at `offset`). */
export function evaluateProfile(profile: Profile, x: ArrayLike<number>, psi: number, offset = 0): { h: number; hd: number; rho: number; q: Vec2 } {
  const w = profile.weights(psi)
  const h = dotw(w.h, x, offset)
  const hd = dotw(w.hd, x, offset)
  const rho = dotw(w.rho, x, offset)
  const c = Math.cos(psi)
  const s = Math.sin(psi)
  return { h, hd, rho, q: { x: h * c - hd * s, y: h * s + hd * c } }
}
