// 8-point Gauss–Legendre nodes and weights on [−1, 1]
const NODES = [
  -0.9602898564975363, -0.796666477413627, -0.525532409916329, -0.1834346424956498,
  0.1834346424956498, 0.525532409916329, 0.796666477413627, 0.9602898564975363,
]
const WEIGHTS = [
  0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362,
  0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
]

/** ∫ f over [a, b] with `segments` panels of 8-point Gauss–Legendre (exact for polynomials up to degree 15). */
export function integrate(f: (x: number) => number, a: number, b: number, segments = 1): number {
  if (a === b) return 0
  let total = 0
  const h = (b - a) / segments
  for (let s = 0; s < segments; s++) {
    const lo = a + s * h
    const half = h / 2
    const mid = lo + half
    let sum = 0
    for (let i = 0; i < NODES.length; i++) sum += WEIGHTS[i] * f(mid + half * NODES[i])
    total += sum * half
  }
  return total
}
