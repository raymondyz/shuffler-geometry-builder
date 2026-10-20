import { useMemo } from 'react'
import { useUnits } from '../../../state/uiStore'
import { EmptyState } from '../../common/Panel'
import { segmentsPath } from '../../plot/paths'
import { Viewport } from '../../plot/Viewport'
import type { ViewProps } from '../types'
import styles from './editor.module.css'
import { editorBounds } from './editorBounds'
import { ContactBand, Overlays } from './Overlays'

/** Read-only view of the previewed foot (Generate mode): outline, bore, slot and the stance band. */
export function FootPreview({ analysis }: ViewProps) {
  const units = useUnits()
  const bounds = useMemo(() => editorBounds(analysis), [analysis])
  if (!analysis.outline) return <EmptyState>No foot outline to show.</EmptyState>
  return (
    <Viewport bounds={bounds} ariaLabel="Preview of the selected generated foot, in the foot frame">
      <Overlays analysis={analysis} units={units} />
      <path d={segmentsPath(analysis.outline.segments, true)} className={styles.outline} />
      <ContactBand analysis={analysis} />
    </Viewport>
  )
}
