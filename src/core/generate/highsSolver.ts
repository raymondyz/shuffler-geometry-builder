import type { Highs } from 'highs'
import type { LinearProgram, LpResult, LpSolver } from './lp'

const OPTIMAL = 7
const INFEASIBLE = 8

/** Adapts a loaded HiGHS runtime (WebAssembly) to the LpSolver interface. Loading is left to the caller. */
export function createHighsSolver(highs: Highs): LpSolver {
  const inf = highs.infinity
  const clampInf = (v: number) => (v === Infinity ? inf : v === -Infinity ? -inf : v)
  const failed = (lp: LinearProgram): LpResult => ({ status: 'failed', x: new Float64Array(lp.numCols), objective: Infinity })
  return (lp: LinearProgram): LpResult => {
    const numRows = lp.rowLower.length
    try {
      return highs.withModel(
        {
          numCols: lp.numCols,
          numRows,
          colCost: lp.cost,
          colLower: lp.colLower.map(clampInf),
          colUpper: lp.colUpper.map(clampInf),
          rowLower: lp.rowLower.map(clampInf),
          rowUpper: lp.rowUpper.map(clampInf),
          matrix: { format: 'csr', numRows, numCols: lp.numCols, starts: lp.rowStarts, indices: lp.rowIndices, values: lp.rowValues },
        },
        (model): LpResult => {
          model.options.set('output_flag', false)
          model.run()
          const status = model.getModelStatus()
          if (status === OPTIMAL) return { status: 'optimal', x: model.getSolution().colValue, objective: model.getObjectiveValue() }
          return status === INFEASIBLE ? { ...failed(lp), status: 'infeasible' } : failed(lp)
        },
      )
    } catch {
      return failed(lp)
    }
  }
}
