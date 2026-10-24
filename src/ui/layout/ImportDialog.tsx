import { useCallback, useMemo, useState } from 'react'
import { analyzeDesign, type Analysis } from '../../core/analysis/analyze'
import { compileOutline, flatten, pointInPolyline, signedArea } from '../../core/curves/outline'
import { boreRadius, slotRadius } from '../../core/design/hardware'
import {
  DEFAULT_IMPORT_OPTIONS,
  previewImport,
  type ImportOptions,
  type ImportPreview,
  type MechanismValues,
} from '../../core/import/importFoot'
import { applyAffine, boundsOf } from '../../core/import/segments'
import { UNITS, type UnitId } from '../../core/import/units'
import { degToRad } from '../../core/math/angle'
import { distance, type Vec2 } from '../../core/math/vec2'
import { useDesignStore } from '../../state/designStore'
import { useUiStore, useUnits } from '../../state/uiStore'
import { Button } from '../common/Button'
import { Checkbox } from '../common/Checkbox'
import { Dialog } from '../common/Dialog'
import { NumberField } from '../common/NumberField'
import { SegmentedControl } from '../common/SegmentedControl'
import { Select } from '../common/Select'
import { formatLength, formatNumber, toDisplay, type Units } from '../format'
import { segmentsPath } from '../plot/paths'
import { Viewport } from '../plot/Viewport'
import { useViewport } from '../plot/viewportContext'
import editor from '../views/editor/editor.module.css'
import styles from './importDialog.module.css'

/** A cross at P1 that keeps its size on screen */
function P1Mark() {
  const { px } = useViewport()
  const r = px(7)
  return (
    <g className={styles.p1}>
      <line x1={-r} x2={r} y1={0} y2={0} />
      <line x1={0} x2={0} y1={-r} y2={r} />
    </g>
  )
}

function OpenEnds({ points }: { points: Vec2[] }) {
  const { px } = useViewport()
  return (
    <g className={styles.openEnd}>
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={px(4)} />)}
    </g>
  )
}

interface CanvasProps {
  preview: ImportPreview
  /** The design as it would be: its bore and slot are drawn over the foot */
  result: Analysis
  onPickPart(index: number): void
  onPickP1(drawingPoint: Vec2): void
}

/** The drawing in the foot frame: other shapes faint, the foot solid, the tool's bore and slot dashed. */
function ImportCanvas({ preview, result, onPickPart, onPickP1 }: CanvasProps) {
  const chosen = preview.part !== null ? preview.parts[preview.part] : null
  const outline = useMemo(() => (preview.design ? compileOutline(preview.design.foot.outline) : (chosen?.outline ?? [])), [preview.design, chosen])
  const bounds = useMemo(() => {
    const all = preview.partAmbiguous || !chosen ? [...preview.parts.flatMap((p) => p.outline), ...preview.loose] : outline
    const b = boundsOf(all.length > 0 ? all : preview.loose)
    const pad = 0.05 * Math.max(b.max.x - b.min.x, b.max.y - b.min.y, 1)
    return { min: { x: b.min.x - pad, y: b.min.y - pad }, max: { x: b.max.x + pad, y: b.max.y + pad } }
  }, [preview, chosen, outline])
  const polylines = useMemo(() => preview.parts.map((p) => flatten(p.outline, 16)), [preview.parts])
  const showGhost = preview.design !== null
  const slot = useMemo(() => segmentsPath(result.mechanism.constraint.slotOutline(slotRadius(result.design.hardware)), true), [result])

  const onClick = (at: Vec2, px: number) => {
    if (preview.needsP1) {
      const snap = preview.snapPoints.find((p) => distance(p, at) < 10 * px)
      onPickP1(applyAffine(preview.toDrawing, snap ?? at))
      return
    }
    if (preview.parts.length < 2) return
    // The smallest part under the pointer
    let pick = -1
    polylines.forEach((poly, i) => {
      if (!pointInPolyline(at, poly)) return
      if (pick < 0 || Math.abs(signedArea(preview.parts[i].outline)) < Math.abs(signedArea(preview.parts[pick].outline))) pick = i
    })
    if (pick >= 0) onPickPart(pick)
  }

  return (
    <Viewport bounds={bounds} onBackgroundClick={onClick} ariaLabel="Preview of the imported foot in the foot frame">
      {preview.parts.map((p, i) => (i === preview.part ? null : <path key={i} d={segmentsPath(p.outline, true)} className={styles.other} />))}
      <path d={segmentsPath(preview.loose)} className={styles.loose} />
      {outline.length > 0 && <path d={segmentsPath(outline, true)} className={editor.outline} />}
      {chosen?.holes.map((h, i) => <path key={i} d={segmentsPath(h, true)} className={editor.cutout} />)}
      {showGhost && (
        <g className={styles.ghost}>
          <circle r={boreRadius(result.design)} />
          <path d={slot} />
        </g>
      )}
      {!preview.needsP1 && chosen && <P1Mark />}
      {/* Open ends only matter when they are why nothing closes; loose construction lines are just faint */}
      {preview.error && <OpenEnds points={preview.openEnds} />}
    </Viewport>
  )
}

function MechanismTable({ file, design, units }: { file: MechanismValues; design: MechanismValues; units: Units }) {
  const rows: [string, number, number][] = [
    ['Pin distance', file.pinDistance, design.pinDistance],
    ['Eccentricity L', file.L, design.L],
    ['Slot width', file.slotWidth, design.slotWidth],
  ]
  return (
    <table className={styles.compare}>
      <thead>
        <tr>
          <th />
          <th>File</th>
          <th>This design</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{formatLength(a, units)}</td>
            <td>{formatLength(b, units)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Preview and options for importing a foot from DXF (SPEC §14.10). Rendered only while open. */
export default function ImportDialog() {
  const parsed = useUiStore((s) => s.importFile)
  const close = useUiStore((s) => s.closeDialog)
  const design = useDesignStore((s) => s.design)
  const units = useUnits()
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS)
  const set = (patch: Partial<ImportOptions>) => setOptions((o) => ({ ...o, ...patch }))
  const fmt = useCallback((mm: number) => formatLength(mm, units), [units])
  const preview = useMemo(() => (parsed ? previewImport(parsed, design, options, fmt) : null), [parsed, design, options, fmt])
  const result = useMemo(() => analyzeDesign(preview?.design ?? design), [preview, design])
  if (!parsed || !preview) return null

  const errors = preview.design ? result.issues.filter((i) => i.level === 'error') : []
  const apply = () => {
    if (!preview.design) return
    useDesignStore.getState().replace(preview.design)
    const ui = useUiStore.getState()
    ui.select(null)
    ui.setMode('design')
    ui.notify('info', `Imported the foot from ${parsed.fileName} (undo to go back).`)
    close()
  }
  const decimals = units === 'mm' ? 1 : 2
  const size = preview.size ? `${formatNumber(toDisplay(preview.size.x, units), decimals)} × ${formatLength(preview.size.y, units, decimals)}` : null
  const summary = [parsed.fileName, size, preview.design ? `${preview.anchors} anchors` : null, preview.design ? (preview.symmetric ? 'symmetric' : 'asymmetric') : null]
  // Changing units changes every coordinate, so earlier picks no longer apply
  const setUnits = (u: UnitId) => set({ units: u, part: null, pickedP1: null })
  const viewKey = [preview.units, preview.part, options.rotation, options.flip, options.pickedP1 ? 'p' : '', preview.needsP1].join(':')

  return (
    <Dialog
      title="Import foot"
      className={styles.wide}
      onClose={close}
      onSubmit={apply}
      actions={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!preview.design}>Import</Button>
        </>
      }
    >
      <div className={styles.canvas}>
        <ImportCanvas
          key={viewKey}
          preview={preview}
          result={result}
          onPickPart={(part) => set({ part, pickedP1: null })}
          onPickP1={(pickedP1) => set({ pickedP1 })}
        />
      </div>
      <p className={styles.summary}>{summary.filter(Boolean).join(' · ')}</p>

      {preview.error && <p className={styles.error}>{preview.error}</p>}
      {preview.needsP1 && <p className={styles.prompt}>No round bore was found. Click the cam bore centre (P1) on the foot.</p>}
      {preview.partAmbiguous && !preview.needsP1 && <p className={styles.prompt}>Several shapes could be the foot. Click the one to import.</p>}

      <div className={styles.rows}>
        <span className={styles.rowLabel}>Units</span>
        <span className={styles.rowControl}>
          <Select<UnitId> label="Drawing units" value={preview.units} options={UNITS.map((u) => ({ value: u.id, label: u.label }))} onChange={setUnits} />
          <span className={styles.hint}>{options.units ? '' : preview.unitsGuessed ? 'guessed' : 'from the file'}</span>
        </span>
        {preview.unitsWarning && <p className={`${styles.warning} ${styles.full}`}>{preview.unitsWarning}</p>}

        {preview.mechanism && (
          <>
            <span className={styles.rowLabel}>Slot</span>
            <span className={styles.rowControl}>
              <SegmentedControl<'file' | 'design'>
                label="Mechanism"
                value={options.keepMechanism ? 'design' : 'file'}
                onChange={(v) => set({ keepMechanism: v === 'design' })}
                options={[
                  { value: 'file', label: "Use the file's", title: 'Set L, the pin distance and the pin size from the slot in the file' },
                  { value: 'design', label: "Keep this design's", title: 'Import only the outline' },
                ]}
              />
            </span>
            <div className={styles.full}>
              <MechanismTable file={preview.mechanism.file} design={preview.mechanism.design} units={units} />
            </div>
          </>
        )}

        {!preview.slotFixed && preview.part !== null && !preview.error && (
          <>
            <span className={styles.rowLabel}>Rotate</span>
            <span className={styles.rowControl}>
              <Button icon="rotateLeft" aria-label="Rotate 90° counter-clockwise" title="Rotate 90° counter-clockwise" onClick={() => set({ rotation: options.rotation + degToRad(90) })} />
              <Button icon="rotateRight" aria-label="Rotate 90° clockwise" title="Rotate 90° clockwise" onClick={() => set({ rotation: options.rotation - degToRad(90) })} />
              <NumberField label="Angle" quantity="angle" value={options.rotation} onChange={(rotation) => set({ rotation })} />
            </span>
          </>
        )}
      </div>

      <div className={styles.checks}>
        {preview.design && !preview.symmetric && (
          <Checkbox label="Flip left to right" title="For a foot drawn from the other side, or for the robot's other module" checked={options.flip} onChange={(flip) => set({ flip })} />
        )}
        {preview.faceted && (
          <Checkbox
            label={`Smooth faceted curves (${preview.faceted.lines} short lines)`}
            title="Rebuild curves exported as many short lines, so the foot rolls instead of rocking on every corner"
            checked={options.smooth}
            onChange={(smooth) => set({ smooth })}
          />
        )}
        {preview.nearSymmetry !== null && (
          <Checkbox label={`Make symmetric (sides differ by up to ${fmt(preview.nearSymmetry)})`} checked={options.makeSymmetric} onChange={(makeSymmetric) => set({ makeSymmetric })} />
        )}
        {preview.hiddenCount > 0 && (
          <Checkbox label={`Include layers that are off or frozen (${preview.hiddenCount} lines and curves)`} checked={options.includeHidden} onChange={(includeHidden) => set({ includeHidden, part: null, pickedP1: null })} />
        )}
        {preview.error && preview.suggestedGap !== null && (
          <Button onClick={() => set({ gap: preview.suggestedGap! })}>Close gaps up to {fmt(preview.suggestedGap)}</Button>
        )}
      </div>

      {errors.length > 0 && (
        <p className={styles.warning}>
          After import: {errors.length === 1 ? errors[0].message : `${errors.length} errors, starting with: ${errors[0].message}`} You can fix this in the editor.
        </p>
      )}

      {preview.notes.length > 0 && (
        <details className={styles.notes}>
          <summary>{preview.notes.length === 1 ? '1 note' : `${preview.notes.length} notes`}</summary>
          <ul>
            {preview.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </details>
      )}
    </Dialog>
  )
}
