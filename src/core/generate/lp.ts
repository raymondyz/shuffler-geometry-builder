/** A linear expression: constant + Σ coef·x[index]. */
export class Expr {
  k: number
  terms: Map<number, number>

  constructor(k = 0, terms = new Map<number, number>()) {
    this.k = k
    this.terms = terms
  }

  static of(index: number, coef = 1): Expr {
    return new Expr(0, new Map([[index, coef]]))
  }

  /** Constant plus dense weights over variables starting at `offset` */
  static dense(k: number, weights: ArrayLike<number>, offset = 0, scale = 1): Expr {
    const e = new Expr(k)
    for (let i = 0; i < weights.length; i++) if (weights[i] !== 0) e.terms.set(offset + i, weights[i] * scale)
    return e
  }

  /** this + s·other (returns a new expression) */
  plus(other: Expr, s = 1): Expr {
    const e = new Expr(this.k + s * other.k, new Map(this.terms))
    for (const [i, c] of other.terms) e.terms.set(i, (e.terms.get(i) ?? 0) + s * c)
    return e
  }

  times(s: number): Expr {
    const e = new Expr(this.k * s)
    for (const [i, c] of this.terms) e.terms.set(i, c * s)
    return e
  }

  value(x: ArrayLike<number>): number {
    let v = this.k
    for (const [i, c] of this.terms) v += c * x[i]
    return v
  }
}

export interface LinearProgram {
  numCols: number
  cost: number[]
  colLower: number[]
  colUpper: number[]
  /** Row-wise sparse matrix with bounds lo ≤ a·x ≤ hi */
  rowStarts: number[]
  rowIndices: number[]
  rowValues: number[]
  rowLower: number[]
  rowUpper: number[]
}

export type LpStatus = 'optimal' | 'infeasible' | 'failed'

export interface LpResult {
  status: LpStatus
  x: Float64Array
  objective: number
}

/** Solves a minimisation LP. Implementations wrap a real solver (HiGHS in the app and tests). */
export type LpSolver = (lp: LinearProgram) => LpResult

const DROP = 1e-13

/** Collects variables and rows; constants in expressions move into the row bounds. */
export class LpBuilder {
  private cost: number[] = []
  private lower: number[] = []
  private upper: number[] = []
  private starts: number[] = [0]
  private indices: number[] = []
  private values: number[] = []
  private rowLower: number[] = []
  private rowUpper: number[] = []
  /** Rows with no variables that can never hold (the model is infeasible as posed) */
  impossible = 0

  addVar(lower = -Infinity, upper = Infinity, cost = 0): number {
    this.cost.push(cost)
    this.lower.push(lower)
    this.upper.push(upper)
    return this.cost.length - 1
  }

  setCost(index: number, cost: number): void {
    this.cost[index] = cost
  }

  /** lo ≤ expr ≤ hi */
  addRow(expr: Expr, lo: number, hi: number): void {
    const entries = [...expr.terms].filter(([, c]) => Math.abs(c) > DROP).sort((a, b) => a[0] - b[0])
    if (entries.length === 0) {
      if (expr.k < lo - 1e-9 || expr.k > hi + 1e-9) this.impossible++
      return
    }
    for (const [i, c] of entries) {
      this.indices.push(i)
      this.values.push(c)
    }
    this.starts.push(this.indices.length)
    this.rowLower.push(lo - expr.k)
    this.rowUpper.push(hi - expr.k)
  }

  atMost(expr: Expr, hi: number): void {
    this.addRow(expr, -Infinity, hi)
  }

  atLeast(expr: Expr, lo: number): void {
    this.addRow(expr, lo, Infinity)
  }

  equal(expr: Expr, value: number): void {
    this.addRow(expr, value, value)
  }

  get size(): number {
    return this.cost.length
  }

  build(): LinearProgram {
    return {
      numCols: this.cost.length,
      cost: [...this.cost],
      colLower: [...this.lower],
      colUpper: [...this.upper],
      rowStarts: [...this.starts],
      rowIndices: [...this.indices],
      rowValues: [...this.values],
      rowLower: [...this.rowLower],
      rowUpper: [...this.rowUpper],
    }
  }
}
