import { useEffect, useMemo } from 'react'
import type { Analysis } from '../../../core/analysis/analyze'
import { outlineOps, symmetrize } from '../../../core/design/mirror'
import { footPresets, presetContext } from '../../../core/design/presets'
import { length } from '../../../core/math/vec2'
import { updateDesign, useDesignStore } from '../../../state/designStore'
import { useUiStore } from '../../../state/uiStore'
import { Checkbox } from '../../common/Checkbox'
import { isTextEntry } from '../../hooks/keyboard'
import controls from '../../common/controls.module.css'
import { Viewport } from '../../plot/Viewport'
import type { Bounds } from '../../plot/viewportContext'
import type { ViewProps } from '../types'
import { EditorCanvas } from './EditorCanvas'
import { Inspector } from './Inspector'
import { updateOutline } from './outlineActions'

function editorBounds(analysis: Analysis): Bounds {
  const pts = analysis.outline?.polyline() ?? []
  const reach = Math.max(30, ...pts.map(length))
  const top = length(analysis.mechanism.constraint.pin) + analysis.design.drive.L
  return { min: { x: -reach, y: -reach }, max: { x: reach, y: Math.max(reach, top + 10) } }
}


function PresetMenu({ analysis }: { analysis: Analysis }) {
  const select = useUiStore((s) => s.select)
  const apply = (id: string) => {
    const preset = footPresets.find((p) => p.id === id)
    if (!preset) return
    // Keep the current foot length (distance from P1 to the lowest point at neutral tilt)
    const current = analysis.outline?.supportMap.evaluate(-Math.PI / 2).h ?? 50
    const footLength = Math.min(300, Math.max(15, current))
    const design = useDesignStore.getState().design
    const outline = preset.create(presetContext(design), footLength)
    updateOutline(() => (design.foot.mirror ? symmetrize(outline) ?? outline : outline))
    select(null)
  }
  return (
    <select className={controls.select} aria-label="Apply a preset outline" value="" onChange={(e) => apply(e.target.value)}>
      <option value="" disabled>
        Presets…
      </option>
      {footPresets.map((p) => (
        <option key={p.id} value={p.id} title={p.description}>
          {p.label}
        </option>
      ))}
    </select>
  )
}

/** Turning Mirror on keeps the right half of the foot and reflects it; turning it off allows free edits again. */
function setMirror(on: boolean) {
  const { select, notify } = useUiStore.getState()
  const { design } = useDesignStore.getState()
  if (!on) {
    updateDesign((d) => ({ ...d, foot: { ...d.foot, mirror: false } }))
    return
  }
  const outline = symmetrize(design.foot.outline)
  if (!outline) {
    notify('error', 'The foot must cross its centreline (x = 0) to be mirrored.')
    return
  }
  updateDesign((d) => ({ ...d, foot: { outline, mirror: true } }))
  select(null)
}

/** Header controls: presets, mirroring and snapping. */
export function FootEditorActions({ analysis }: ViewProps) {
  const snap = useUiStore((s) => s.snap)
  const setPreference = useUiStore((s) => s.setPreference)
  const mirror = useDesignStore((s) => s.design.foot.mirror)
  return (
    <>
      <PresetMenu analysis={analysis} />
      <Checkbox
        label="Mirror"
        checked={mirror}
        onChange={setMirror}
        title="Keep the foot symmetric about its centreline; edits on one side copy to the other. Turning it on keeps the right half."
      />
      <Checkbox label="Snap to grid" checked={snap} onChange={(v) => setPreference('snap', v)} />
    </>
  )
}

export function FootEditor({ analysis }: ViewProps) {
  const select = useUiStore((s) => s.select)
  const bounds = useMemo(() => editorBounds(analysis), [analysis])

  // Delete removes the selected anchor; Escape clears the selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return
      const { selection } = useUiStore.getState()
      if (e.key === 'Escape') select(null)
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection?.kind === 'node') {
        e.preventDefault()
        const { design } = useDesignStore.getState()
        const ops = outlineOps(design.foot.mirror)
        if (!ops.canDelete(design.foot.outline, selection.id)) return
        updateOutline((o) => ops.deleteNode(o, selection.id))
        select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])

  return (
    <>
      <Viewport
        bounds={bounds}
        onBackgroundClick={() => select(null)}
        ariaLabel="Foot outline editor, drawn in the foot frame with P1 at the origin"
      >
        <EditorCanvas analysis={analysis} />
      </Viewport>
      <Inspector analysis={analysis} />
    </>
  )
}
