import { DxfWriter, Units, point3d } from '@tarikjabiri/dxf'
import { radToDeg } from '../math/angle'
import { add, type Vec2 } from '../math/vec2'
import type { Segment } from '../curves/segment'
import { partBounds, type Part } from './parts'

const LAYERS: Record<Part['layer'], { name: string; color: number }> = {
  foot: { name: 'FOOT', color: 7 },
  cam: { name: 'CAM', color: 7 },
  frame: { name: 'FRAME', color: 7 },
  reference: { name: 'REFERENCE', color: 5 },
}

function addSegment(dxf: DxfWriter, seg: Segment, o: Vec2, layerName: string) {
  const p = (v: Vec2) => point3d(v.x + o.x, v.y + o.y, 0)
  switch (seg.kind) {
    case 'line':
      dxf.addLine(p(seg.p0), p(seg.p1), { layerName })
      return
    case 'arc': {
      // DXF arcs run CCW from start to end angle (degrees)
      const a0 = seg.sweep > 0 ? seg.startAngle : seg.startAngle + seg.sweep
      const a1 = a0 + Math.abs(seg.sweep)
      if (Math.abs(seg.sweep) >= 2 * Math.PI - 1e-9) {
        dxf.addCircle(p(seg.center), seg.radius, { layerName })
        return
      }
      dxf.addArc(p(seg.center), seg.radius, radToDeg(a0), radToDeg(a1), { layerName })
      return
    }
    case 'cubic':
      // A single cubic Bézier is exactly a clamped degree-3 B-spline with knots [0,0,0,0,1,1,1,1]
      dxf.addSpline({
        controlPoints: [p(seg.p0), p(seg.p1), p(seg.p2), p(seg.p3)],
        degreeCurve: 3,
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
      }, { layerName })
  }
}

/** DXF (millimetres) with one layer per part type. Lines, arcs and cubic splines are exact. */
export function exportDxf(parts: Part[]): string {
  const dxf = new DxfWriter()
  dxf.setUnits(Units.Millimeters)
  for (const layer of Object.values(LAYERS)) dxf.addLayer(layer.name, layer.color, 'CONTINUOUS')
  dxf.addLayer('LABELS', 8, 'CONTINUOUS')
  for (const part of parts) {
    const layerName = LAYERS[part.layer].name
    for (const path of part.paths) for (const seg of path) addSegment(dxf, seg, part.offset, layerName)
    for (const c of part.circles) {
      const center = add(c.center, part.offset)
      dxf.addCircle(point3d(center.x, center.y, 0), c.radius, { layerName })
    }
    dxf.addText(point3d(partBounds(part).min.x, -8, 0), 3, part.label, { layerName: 'LABELS' })
  }
  return dxf.stringify()
}
