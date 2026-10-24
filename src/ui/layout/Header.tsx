import { lazy, Suspense } from 'react'
import type { Analysis } from '../../core/analysis/analyze'
import { useDesignStore } from '../../state/designStore'
import { useGeneratorStore } from '../../state/generatorStore'
import { useUiStore, type AppMode } from '../../state/uiStore'
import { useDesignAnalysis } from '../../state/useAnalysis'
import { Button } from '../common/Button'
import { Icon } from '../common/Icon'
import { Menu } from '../common/Menu'
import { SegmentedControl } from '../common/SegmentedControl'
import type { Units } from '../format'
import { exportDxfFile, exportSvgFile, importFootDxf, newDesign, openDesign } from './fileActions'
import { SaveDialog } from './SaveDialog'
import styles from './layout.module.css'

// The import dialog and the DXF reader load only when a DXF is opened
const ImportDialog = lazy(() => import('./ImportDialog'))

function NoticeBanner() {
  const notice = useUiStore((s) => s.notice)
  const dismiss = useUiStore((s) => s.dismissNotice)
  if (!notice) return null
  return (
    <div className={notice.level === 'error' ? `${styles.notice} ${styles.noticeError}` : styles.notice} role="status">
      {notice.level === 'error' && <Icon name="error" />}
      <span>{notice.text}</span>
      <Button variant="ghost" icon="close" aria-label="Dismiss" onClick={dismiss} />
    </div>
  )
}

export function Header({ analysis }: { analysis: Analysis }) {
  const canUndo = useDesignStore((s) => s.past.length > 0)
  const canRedo = useDesignStore((s) => s.future.length > 0)
  const undo = useDesignStore((s) => s.undo)
  const redo = useDesignStore((s) => s.redo)
  const units = useUiStore((s) => s.units)
  const setPreference = useUiStore((s) => s.setPreference)
  const canExport = analysis.outline !== null
  const dialog = useUiStore((s) => s.dialog)
  const openDialog = useUiStore((s) => s.openDialog)
  const mode = useUiStore((s) => s.mode)
  const design = useDesignStore((s) => s.design)
  const designAnalysis = useDesignAnalysis()
  const switchMode = (next: AppMode) => {
    if (next === 'generate') useGeneratorStore.getState().ensureBrief(design, designAnalysis)
    useUiStore.getState().setMode(next)
  }
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>Shuffler Geometry Builder</h1>
      <span className={styles.designName} title="Design name (set when saving)">{analysis.design.name}</span>
      <Menu
        label="File"
        items={[
          { label: 'New design', onSelect: newDesign },
          { label: 'Open…', onSelect: openDesign },
          { label: 'Import foot (DXF)…', onSelect: importFootDxf },
          { label: 'Save…', onSelect: () => openDialog('save') },
          { label: 'Export SVG', onSelect: () => exportSvgFile(analysis), disabled: !canExport, divider: true },
          { label: 'Export DXF', onSelect: () => exportDxfFile(analysis), disabled: !canExport },
        ]}
      />
      <div className={styles.headerGroup}>
        <Button icon="undo" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!canUndo} onClick={undo} />
        <Button icon="redo" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!canRedo} onClick={redo} />
      </div>
      <SegmentedControl<AppMode>
        label="Mode"
        value={mode}
        onChange={switchMode}
        options={[
          { value: 'design', label: 'Design', title: 'Edit the current design' },
          { value: 'generate', label: 'Generate', title: 'Describe what you need and let the tool design the foot and mechanism' },
        ]}
      />
      <span className={styles.spacer} />
      <SegmentedControl<Units>
        label="Display units"
        value={units}
        onChange={(v) => setPreference('units', v)}
        options={[
          { value: 'mm', label: 'mm' },
          { value: 'in', label: 'in' },
        ]}
      />
      <NoticeBanner />
      {dialog === 'save' && <SaveDialog />}
      {dialog === 'import' && (
        <Suspense fallback={null}>
          <ImportDialog />
        </Suspense>
      )}
    </header>
  )
}
