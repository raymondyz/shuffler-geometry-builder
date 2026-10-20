/** Real roots of a·t² + b·t + c = 0 (handles the degenerate linear case). */
export function solveQuadratic(a: number, b: number, c: number): number[] {
  const scaleRef = Math.max(Math.abs(a), Math.abs(b), Math.abs(c))
  if (scaleRef === 0) return []
  if (Math.abs(a) <= 1e-14 * scaleRef) {
    if (Math.abs(b) <= 1e-14 * scaleRef) return []
    return [-c / b]
  }
  const disc = b * b - 4 * a * c
  if (disc < 0) {
    // Treat tiny negative discriminants as a double root
    if (disc > -1e-14 * b * b) return [-b / (2 * a)]
    return []
  }
  const sq = Math.sqrt(disc)
  const q = -0.5 * (b + (b >= 0 ? sq : -sq))
  const r1 = q / a
  const r2 = q !== 0 ? c / q : -b / (2 * a)
  return r1 <= r2 ? [r1, r2] : [r2, r1]
}

/**
 * Brent's method: finds a root of f in [a, b] given f(a), f(b) of opposite sign (or zero).
 * Falls back to the endpoint with the smaller |f| if there is no sign change.
 */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-13, maxIter = 100): number {
  let fa = f(a)
  let fb = f(b)
  if (fa === 0) return a
  if (fb === 0) return b
  if (fa * fb > 0) return Math.abs(fa) < Math.abs(fb) ? a : b
  let c = a
  let fc = fa
  let d = b - a
  let e = d
  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) {
      c = a
      fc = fa
      d = b - a
      e = d
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b
      b = c
      c = a
      fa = fb
      fb = fc
      fc = fa
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol
    const xm = 0.5 * (c - b)
    if (Math.abs(xm) <= tol1 || fb === 0) return b
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa
      let p: number
      let q: number
      if (a === c) {
        p = 2 * xm * s
        q = 1 - s
      } else {
        const qa = fa / fc
        const r = fb / fc
        p = s * (2 * xm * qa * (qa - r) - (b - a) * (r - 1))
        q = (qa - 1) * (r - 1) * (s - 1)
      }
      if (p > 0) q = -q
      p = Math.abs(p)
      const min1 = 3 * xm * q - Math.abs(tol1 * q)
      const min2 = Math.abs(e * q)
      if (2 * p < Math.min(min1, min2)) {
        e = d
        d = p / q
      } else {
        d = xm
        e = d
      }
    } else {
      d = xm
      e = d
    }
    a = b
    fa = fb
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1
    fb = f(b)
  }
  return b
}

/**
 * All roots of f on [a, b], found by bracketing sign changes on a uniform grid and refining with Brent.
 * Roots closer together than the grid spacing may be missed.
 */
export function rootsOnInterval(f: (x: number) => number, a: number, b: number, samples = 32): number[] {
  const roots: number[] = []
  let x0 = a
  let f0 = f(a)
  for (let i = 1; i <= samples; i++) {
    const x1 = a + ((b - a) * i) / samples
    const f1 = f(x1)
    if (f0 === 0) {
      roots.push(x0)
    } else if (f0 * f1 < 0) {
      roots.push(brent(f, x0, x1))
    }
    x0 = x1
    f0 = f1
  }
  if (f0 === 0) roots.push(x0)
  return roots
}
