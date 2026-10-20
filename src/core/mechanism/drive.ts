import type { Vec2 } from '../math/vec2'

/** Moves the foot bearing centre P1 as a function of cam angle φ (P0 is the body-frame origin). */
export interface Drive {
  kind: string
  /** Eccentricity: |P0 P1| for a circular cam */
  L: number
  p1(phi: number): Vec2
  p1d(phi: number): Vec2
  p1dd(phi: number): Vec2
}

/** Circular disc cam with its shaft bore offset by L: P1 = L·n(φ). */
export function eccentricDrive(L: number): Drive {
  return {
    kind: 'eccentric',
    L,
    p1: (phi) => ({ x: L * Math.cos(phi), y: L * Math.sin(phi) }),
    p1d: (phi) => ({ x: -L * Math.sin(phi), y: L * Math.cos(phi) }),
    p1dd: (phi) => ({ x: -L * Math.cos(phi), y: -L * Math.sin(phi) }),
  }
}
