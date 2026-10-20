export interface Vec2 {
  x: number
  y: number
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y })

export const ZERO: Vec2 = { x: 0, y: 0 }

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })

export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })

/** a + b * s */
export const addScaled = (a: Vec2, b: Vec2, s: number): Vec2 => ({ x: a.x + b.x * s, y: a.y + b.y * s })

export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y })

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y

/** 2D cross product a × b = ax·by − ay·bx */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x

export const length = (a: Vec2): number => Math.hypot(a.x, a.y)

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

export const normalize = (a: Vec2): Vec2 => {
  const l = Math.hypot(a.x, a.y)
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }
}

/** Rotate by +90° (the J operator): (x, y) → (−y, x) */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })

export const rotate = (a: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: c * a.x - s * a.y, y: s * a.x + c * a.y }
}

/** Unit vector n(θ) = (cos θ, sin θ), optionally scaled */
export const fromAngle = (angle: number, r = 1): Vec2 => ({ x: r * Math.cos(angle), y: r * Math.sin(angle) })

export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x)

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

export const midpoint = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export const equals = (a: Vec2, b: Vec2, eps = 1e-12): boolean => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
