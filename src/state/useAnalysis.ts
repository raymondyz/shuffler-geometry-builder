import { useMemo } from 'react'
import { createAnalyzer, type Analysis } from '../core/analysis/analyze'
import { useDesignStore } from './designStore'
import { usePreviewDesign } from './generatorStore'

const designAnalyzer = createAnalyzer()
const previewAnalyzer = createAnalyzer()

/** The analysis of the current design; stages are memoised so only what changed is recomputed. */
export function useDesignAnalysis(): Analysis {
  const design = useDesignStore((s) => s.design)
  return useMemo(() => designAnalyzer(design), [design])
}

/** What the views show: the selected generated candidate while in Generate mode, otherwise the design. */
export function useAnalysis(): Analysis {
  const designAnalysis = useDesignAnalysis()
  const preview = usePreviewDesign()
  return useMemo(() => (preview ? previewAnalyzer(preview) : designAnalysis), [preview, designAnalysis])
}
