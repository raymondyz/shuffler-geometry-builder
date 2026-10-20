import { useMemo } from 'react'
import { createAnalyzer, type Analysis } from '../core/analysis/analyze'
import { useDesignStore } from './designStore'

const analyzer = createAnalyzer()

/** The analysis of the current design; stages are memoised so only what changed is recomputed. */
export function useAnalysis(): Analysis {
  const design = useDesignStore((s) => s.design)
  return useMemo(() => analyzer(design), [design])
}
