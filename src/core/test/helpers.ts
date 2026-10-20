import type { Outline, OutlineNode } from '../curves/outline'
import { fromAngle, scale, sub, type Vec2 } from '../math/vec2'

/** Deterministic PRNG for reproducible random tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Random star-shaped closed outline through `count` points, smoothed as a Catmull-Rom cubic chain. */
export function randomOutline(rand: () => number, count = 7, radius = 40, wobble = 0.45): Outline {
  const pts: Vec2[] = Array.from({ length: count }, (_, i) => {
    const theta = (2 * Math.PI * (i + 0.3 * (rand() - 0.5))) / count
    return fromAngle(theta, radius * (1 - wobble / 2 + wobble * rand()))
  })
  const nodes: OutlineNode[] = pts.map((p, i) => {
    const tangent = scale(sub(pts[(i + 1) % count], pts[(i - 1 + count) % count]), 1 / 6)
    return { id: `r${i}`, p, hIn: scale(tangent, -1), hOut: tangent, mode: 'smooth' }
  })
  return { nodes, edges: nodes.map(() => ({ kind: 'cubic' as const, bulge: 0 })) }
}

/** Central finite difference. */
export const fd = (f: (x: number) => number, x: number, h = 1e-6): number => (f(x + h) - f(x - h)) / (2 * h)
