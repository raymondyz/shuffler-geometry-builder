import type { Analysis } from '../../core/analysis/analyze'
import { createDefaultDesign } from '../../core/design/defaults'
import { DEFAULT_NAME } from '../../core/design/schema'
import { DESIGN_FILE_EXTENSION, parseDesign, serializeDesign } from '../../core/design/serialize'
import { buildParts } from '../../core/export/parts'
import { exportSvg } from '../../core/export/svg'
import { updateDesign, useDesignStore } from '../../state/designStore'
import { useUiStore } from '../../state/uiStore'

const notify = (level: 'info' | 'error', text: string) => useUiStore.getState().notify(level, text)

/** A safe file name from a design name (no path separators or reserved characters). */
export function fileBaseName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 100)
  return cleaned || 'shuffler'
}

const nameFromFile = (fileName: string) => fileName.replace(/\.shuffler\.json$|\.json$/i, '') || DEFAULT_NAME

function download(filename: string, text: string, type: string) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {
    notify('error', 'The browser blocked the download.')
  }
}

export function newDesign() {
  useDesignStore.getState().replace(createDefaultDesign())
  useUiStore.getState().select(null)
  notify('info', 'Started a new design (undo to go back).')
}

export function openDesign() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = `${DESIGN_FILE_EXTENSION},.json,application/json`
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const design = parseDesign(await file.text())
      // Older files have no name: use the file name instead
      useDesignStore.getState().replace(design.name === DEFAULT_NAME ? { ...design, name: nameFromFile(file.name) } : design)
      useUiStore.getState().select(null)
      notify('info', `Opened ${file.name}`)
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not open that file.')
    }
  }
  input.click()
}

/** Rename the design (if the name changed) and download it as <name>.shuffler.json. */
export function saveDesign(name: string) {
  const trimmed = name.trim() || DEFAULT_NAME
  if (trimmed !== useDesignStore.getState().design.name) updateDesign((d) => ({ ...d, name: trimmed }))
  const design = useDesignStore.getState().design
  download(`${fileBaseName(design.name)}${DESIGN_FILE_EXTENSION}`, serializeDesign(design), 'application/json')
}

export function exportSvgFile(analysis: Analysis) {
  download(`${fileBaseName(analysis.design.name)}-parts.svg`, exportSvg(buildParts(analysis, { includeReference: true })), 'image/svg+xml')
}

/** The DXF writer is loaded on demand to keep it out of the initial bundle. */
export async function exportDxfFile(analysis: Analysis) {
  try {
    const { exportDxf } = await import('../../core/export/dxf')
    download(`${fileBaseName(analysis.design.name)}-parts.dxf`, exportDxf(buildParts(analysis, { includeReference: true })), 'application/dxf')
  } catch {
    notify('error', 'Could not create the DXF file.')
  }
}
