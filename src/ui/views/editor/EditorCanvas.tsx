import { useMemo, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Analysis } from '../../../core/analysis/analyze'
import { bulgeFromMidpoint, bulgeMidpoint, compileOutline, nearestParameter, type Outline, type OutlineNode } from '../../../core/curves/outline'
import { add, sub, type Vec2 } from '../../../core/math/vec2'
import { useUiStore, useUnits, type EditorSelection } from '../../../state/uiStore'
import { lengthStep } from '../../format'
import { segmentsPath } from '../../plot/paths'
import { useViewport } from '../../plot/viewportContext'
import styles from './editor.module.css'
import { snapTo, updateOutline } from './outlineActions'
import { ContactBand, Overlays } from './Overlays'
import { useOutlineOps } from './useOutlineOps'
import { useWorldDrag } from './useWorldDrag'

interface HandleRef {
  node: OutlineNode
  which: 'in' | 'out'
}

/** Handles to show: those of the selected node, or of the selected cubic edge. */
function visibleHandles(outline: Outline, selection: EditorSelection): HandleRef[] {
  const n = outline.nodes.length
  if (!selection) return []
  if (selection.kind === 'node') {
    const i = outline.nodes.findIndex((nd) => nd.id === selection.id)
    if (i < 0) return []
    const handles: HandleRef[] = []
    if (outline.edges[(i - 1 + n) % n].kind === 'cubic') handles.push({ node: outline.nodes[i], which: 'in' })
    if (outline.edges[i].kind === 'cubic') handles.push({ node: outline.nodes[i], which: 'out' })
    return handles
  }
  const i = selection.index
  if (outline.edges[i]?.kind !== 'cubic') return []
  return [
    { node: outline.nodes[i], which: 'out' },
    { node: outline.nodes[(i + 1) % n], which: 'in' },
  ]
}

export function EditorCanvas({ analysis }: { analysis: Analysis }) {
  const outline = analysis.design.foot.outline
  const selection = useUiStore((s) => s.selection)
  const select = useUiStore((s) => s.select)
  const snap = useUiStore((s) => s.snap)
  const units = useUnits()
  const { px, toWorld } = useViewport()
  const drag = useWorldDrag()
  const ops = useOutlineOps()
  const segments = useMemo(() => compileOutline(outline), [outline])
  const snapPoint = (p: Vec2) => (snap ? snapTo(p, lengthStep(units)) : p)
  const n = outline.nodes.length

  const startNodeDrag = (e: ReactPointerEvent<Element>, node: OutlineNode) => {
    select({ kind: 'node', id: node.id })
    const grab = sub(node.p, toWorld(e.clientX, e.clientY))
    drag(e, (w) => updateOutline((o) => ops.moveNode(o, node.id, snapPoint(add(w, grab)))))
  }

  const startHandleDrag = (e: ReactPointerEvent<Element>, { node, which }: HandleRef) => {
    drag(e, (w) => updateOutline((o) => {
      const current = o.nodes.find((nd) => nd.id === node.id)
      return current ? ops.moveHandle(o, node.id, which, sub(snapPoint(w), current.p)) : o
    }))
  }

  const startBulgeDrag = (e: ReactPointerEvent<Element>, index: number) => {
    select({ kind: 'edge', index })
    drag(e, (w) => updateOutline((o) => {
      const a = o.nodes[index].p
      const b = o.nodes[(index + 1) % o.nodes.length].p
      return ops.setEdgeBulge(o, index, bulgeFromMidpoint(a, b, w))
    }))
  }

  const insertAt = (e: ReactMouseEvent<Element>, index: number) => {
    const { t } = nearestParameter(segments[index], toWorld(e.clientX, e.clientY))
    const result = ops.insertNode(outline, index, Math.min(0.98, Math.max(0.02, t)))
    updateOutline(() => result.outline)
    select({ kind: 'node', id: result.id })
  }

  const handles = visibleHandles(outline, selection)
  const nodeSize = px(4.5)

  return (
    <g>
      <Overlays analysis={analysis} units={units} />
      <path d={segmentsPath(segments, true)} className={styles.outline} />
      <ContactBand analysis={analysis} />

      {segments.map((seg, i) => {
        const selected = selection?.kind === 'edge' && selection.index === i
        const d = segmentsPath([seg])
        return (
          <g key={i}>
            {selected && <path d={d} className={styles.edgeSelected} />}
            <path
              d={d}
              className={styles.edgeHit}
              onPointerDown={(e) => {
                e.stopPropagation()
                select({ kind: 'edge', index: i })
              }}
              onDoubleClick={(e) => insertAt(e, i)}
            />
          </g>
        )
      })}

      {handles.map((h) => {
        const offset = h.which === 'in' ? h.node.hIn : h.node.hOut
        const at = add(h.node.p, offset)
        return (
          <g key={`${h.node.id}-${h.which}`}>
            <line x1={h.node.p.x} y1={h.node.p.y} x2={at.x} y2={at.y} className={styles.handleLine} />
            <circle cx={at.x} cy={at.y} r={px(4)} className={styles.handle} />
            <circle cx={at.x} cy={at.y} r={px(12)} className={styles.hit} onPointerDown={(e) => startHandleDrag(e, h)} />
          </g>
        )
      })}

      {outline.edges.map((edge, i) => {
        if (edge.kind !== 'arc') return null
        const showBulge = (selection?.kind === 'edge' && selection.index === i)
          || (selection?.kind === 'node' && (outline.nodes[i].id === selection.id || outline.nodes[(i + 1) % n].id === selection.id))
        if (!showBulge) return null
        const m = bulgeMidpoint(outline.nodes[i].p, outline.nodes[(i + 1) % n].p, edge.bulge)
        const r = px(5)
        return (
          <g key={`bulge-${i}`}>
            <path d={`M ${m.x} ${m.y - r} L ${m.x + r} ${m.y} L ${m.x} ${m.y + r} L ${m.x - r} ${m.y} Z`} className={styles.handle} />
            <circle cx={m.x} cy={m.y} r={px(12)} className={styles.hit} onPointerDown={(e) => startBulgeDrag(e, i)} />
          </g>
        )
      })}

      {outline.nodes.map((node) => {
        const selected = selection?.kind === 'node' && selection.id === node.id
        const cls = `${styles.node} ${selected ? styles.nodeSelected : ''}`
        return (
          <g key={node.id}>
            {node.mode === 'corner' ? (
              <rect x={node.p.x - nodeSize} y={node.p.y - nodeSize} width={2 * nodeSize} height={2 * nodeSize} className={cls} />
            ) : (
              <circle cx={node.p.x} cy={node.p.y} r={nodeSize * 1.1} className={cls} />
            )}
            <circle cx={node.p.x} cy={node.p.y} r={px(12)} className={styles.hit} onPointerDown={(e) => startNodeDrag(e, node)} />
          </g>
        )
      })}
    </g>
  )
}
