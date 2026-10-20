export const TAU = 2 * Math.PI

/** Wrap an angle into [−π, π) */
export const wrapPi = (a: number): number => a - TAU * Math.floor((a + Math.PI) / TAU)

/** Wrap an angle into [0, 2π) */
export const wrapTau = (a: number): number => a - TAU * Math.floor(a / TAU)

export const degToRad = (deg: number): number => (deg * Math.PI) / 180

export const radToDeg = (rad: number): number => (rad * 180) / Math.PI

/** True if angle a lies on the CCW arc that starts at `start` and spans `span` (≥ 0) radians */
export const angleInArc = (a: number, start: number, span: number, eps = 0): boolean => {
  if (span >= TAU) return true
  const d = wrapTau(a - start)
  return d <= span + eps || d >= TAU - eps
}
