/** "Nice" tick values covering [min, max] with roughly `count` steps (1, 2, 2.5, 5 × 10ⁿ). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const start = Math.ceil(min / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return ticks
}

/** Decimal places needed to print ticks with the spacing of `ticks`. */
export function tickDecimals(ticks: number[]): number {
  if (ticks.length < 2) return 2
  const step = Math.abs(ticks[1] - ticks[0])
  let decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const scaled = step * 10 ** decimals
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) decimals++
  return Math.min(4, decimals)
}
