import type { Analysis } from '../../../core/analysis/analyze'
import { arcFromBulge, type EdgeKind, type NodeMode } from '../../../core/curves/outline'
import { angleOf, fromAngle, length } from '../../../core/math/vec2'
import { gestureProps } from '../../../state/designStore'
import { useUiStore, useUnits } from '../../../state/uiStore'
import { Button } from '../../common/Button'
import { NumberField } from '../../common/NumberField'
import { SegmentedControl } from '../../common/SegmentedControl'
import { formatLength } from '../../format'
import styles from './editor.module.css'
import { updateOutline } from './outlineActions'
import { useOutlineOps } from './useOutlineOps'

const NODE_MODES: { value: NodeMode; label: string; title: string }[] = [
  { value: 'corner', label: 'Corner', title: 'Handles move independently' },
  { value: 'smooth', label: 'Smooth', title: 'Handles stay in line (tangent continuous)' },
  { value: 'symmetric', label: 'Symmetric', title: 'Handles stay in line and equal length' },
]

const EDGE_KINDS: { value: EdgeKind; label: string; title: string }[] = [
  { value: 'cubic', label: 'Bézier', title: 'Cubic Bézier with two handles' },
  { value: 'line', label: 'Line', title: 'Straight line' },
  { value: 'arc', label: 'Arc', title: 'Circular arc (drag the diamond to bend)' },
]

function NodeInspector({ analysis, id }: { analysis: Analysis; id: string }) {
  const outline = analysis.design.foot.outline
  const select = useUiStore((s) => s.select)
  const ops = useOutlineOps()
  const node = outline.nodes.find((nd) => nd.id === id)
  if (!node) return null
  const onAxis = ops.isAxisNode(outline, node.id)
  const r = length(node.p)
  const theta = angleOf(node.p)
  const set = (p: { x: number; y: number }) => updateOutline((o) => ops.moveNode(o, node.id, p))
  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorHead}>
        <span className={styles.inspectorTitle}>Anchor</span>
        <SegmentedControl label="Anchor type" options={NODE_MODES} value={node.mode} onChange={(mode) => updateOutline((o) => ops.setNodeMode(o, node.id, mode))} />
        <span className={styles.grow} />
        <Button
          icon="trash"
          disabled={!ops.canDelete(outline, node.id)}
          title={onAxis ? 'Anchors on the mirror line cannot be deleted' : undefined}
          onClick={() => {
            updateOutline((o) => ops.deleteNode(o, node.id))
            select(null)
          }}
        >
          Delete
        </Button>
      </div>
      <div className={styles.inspectorFields}>
        <NumberField layout="stacked" label="X" quantity="length" value={node.p.x} disabled={onAxis} onChange={(x) => set({ ...node.p, x })} title={onAxis ? 'On the mirror line' : undefined} />
        <NumberField layout="stacked" label="Y" quantity="length" value={node.p.y} onChange={(y) => set({ ...node.p, y })} />
        <NumberField layout="stacked" label="r from P1" quantity="length" min={0} value={r} onChange={(v) => set(fromAngle(theta, v))} title="Distance from the cam bearing centre P1" />
        <NumberField layout="stacked" label="θ about P1" quantity="angle" value={theta} onChange={(v) => set(fromAngle(v, r))} title="Angle from +x, counter-clockwise (−90° is straight down)" />
      </div>
    </div>
  )
}

function EdgeInspector({ analysis, index }: { analysis: Analysis; index: number }) {
  const outline = analysis.design.foot.outline
  const select = useUiStore((s) => s.select)
  const units = useUnits()
  const ops = useOutlineOps()
  const n = outline.nodes.length
  const edge = outline.edges[index]
  const a = outline.nodes[index].p
  const b = outline.nodes[(index + 1) % n].p
  const arc = edge.kind === 'arc' && Math.abs(edge.bulge) > 1e-9 ? arcFromBulge(a, b, edge.bulge) : null
  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorHead}>
        <span className={styles.inspectorTitle}>Edge</span>
        <SegmentedControl label="Edge type" options={EDGE_KINDS} value={edge.kind} onChange={(kind) => updateOutline((o) => ops.setEdgeKind(o, index, kind))} />
        <span className={styles.grow} />
        <Button
          icon="plus"
          onClick={() => {
            const result = ops.insertNode(outline, index, 0.5)
            updateOutline(() => result.outline)
            select({ kind: 'node', id: result.id })
          }}
        >
          Add anchor
        </Button>
      </div>
      {edge.kind === 'arc' && (
        <div className={styles.inspectorFields}>
          <NumberField
            layout="stacked"
            label="Sweep"
            quantity="angle"
            min={-Math.PI * 1.9}
            max={Math.PI * 1.9}
            value={4 * Math.atan(edge.bulge)}
            onChange={(sweep) => updateOutline((o) => ops.setEdgeBulge(o, index, Math.tan(sweep / 4)))}
            title="Positive bends counter-clockwise"
            {...gestureProps}
          />
          {arc && <span className={styles.readout}>Radius {formatLength(arc.radius, units)}</span>}
        </div>
      )}
    </div>
  )
}

/** Numeric editing of the selected anchor or edge, below the editor canvas. */
export function Inspector({ analysis }: { analysis: Analysis }) {
  const selection = useUiStore((s) => s.selection)
  const n = analysis.design.foot.outline.nodes.length
  if (selection?.kind === 'node') return <NodeInspector analysis={analysis} id={selection.id} />
  if (selection?.kind === 'edge' && selection.index < n) return <EdgeInspector analysis={analysis} index={selection.index} />
  return (
    <div className={styles.inspector}>
      <span className={styles.hint}>Click an anchor or edge to edit it · double-click an edge to add an anchor</span>
    </div>
  )
}
