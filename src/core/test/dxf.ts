import { endPoint, startPoint, type Segment } from '../curves/segment'
import { radToDeg } from '../math/angle'
import type { Vec2 } from '../math/vec2'

// Builds small ASCII DXF files for import tests, with exactly the group codes a case needs.

export type Code = [number, number | string]

export const entity = (type: string, codes: Code[], layer = '0'): string[] => [
  '0',
  type,
  '8',
  layer,
  ...codes.flatMap(([c, v]) => [String(c), String(v)]),
]

export const line = (a: Vec2, b: Vec2, layer?: string): string[] =>
  entity('LINE', [[10, a.x], [20, a.y], [30, 0], [11, b.x], [21, b.y], [31, 0]], layer)

export const arc = (c: Vec2, r: number, startDeg: number, endDeg: number, extra: Code[] = [], layer?: string): string[] =>
  entity('ARC', [[10, c.x], [20, c.y], [30, 0], [40, r], [50, startDeg], [51, endDeg], ...extra], layer)

export const circle = (c: Vec2, r: number, extra: Code[] = [], layer?: string): string[] =>
  entity('CIRCLE', [[10, c.x], [20, c.y], [30, 0], [40, r], ...extra], layer)

export const lwpolyline = (pts: (Vec2 & { bulge?: number })[], closed: boolean, extra: Code[] = [], layer?: string): string[] =>
  entity(
    'LWPOLYLINE',
    [
      [90, pts.length],
      [70, closed ? 1 : 0],
      ...pts.flatMap((p): Code[] => [[10, p.x], [20, p.y], ...(p.bulge ? ([[42, p.bulge]] as Code[]) : [])]),
      ...extra,
    ],
    layer,
  )

export const spline = (degree: number, knots: number[], points: Vec2[], weights: number[] = [], layer?: string): string[] =>
  entity(
    'SPLINE',
    [
      [70, weights.length > 0 ? 12 : 8],
      [71, degree],
      [72, knots.length],
      [73, points.length],
      [74, 0],
      ...knots.map((k): Code => [40, k]),
      ...weights.map((w): Code => [41, w]),
      ...points.flatMap((p): Code[] => [[10, p.x], [20, p.y], [30, 0]]),
    ],
    layer,
  )

/** Entities for a chain of segments: LINE, ARC (counter-clockwise, as DXF stores them) and one SPLINE per cubic. */
export function segmentEntities(segments: Segment[], layer?: string): string[][] {
  return segments.map((s) => {
    switch (s.kind) {
      case 'line':
        return line(startPoint(s), endPoint(s), layer)
      case 'arc': {
        const a0 = s.sweep > 0 ? s.startAngle : s.startAngle + s.sweep
        return arc(s.center, s.radius, radToDeg(a0), radToDeg(a0 + Math.abs(s.sweep)), [], layer)
      }
      case 'cubic':
        return spline(3, [0, 0, 0, 0, 1, 1, 1, 1], [s.p0, s.p1, s.p2, s.p3], [], layer)
    }
  })
}

export interface DxfOptions {
  /** $INSUNITS; null leaves it out */
  units?: number | null
  layers?: { name: string; color?: number; flags?: number }[]
  blocks?: { name: string; base?: Vec2; entities: string[][] }[]
}

export function dxfText(entities: string[][], { units = 4, layers = [], blocks = [] }: DxfOptions = {}): string {
  const lines: string[] = ['0', 'SECTION', '2', 'HEADER']
  if (units !== null) lines.push('9', '$INSUNITS', '70', String(units))
  lines.push('0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER')
  for (const l of layers) lines.push('0', 'LAYER', '2', l.name, '70', String(l.flags ?? 0), '62', String(l.color ?? 7))
  lines.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'BLOCKS')
  for (const b of blocks) {
    lines.push('0', 'BLOCK', '8', '0', '2', b.name, '70', '0', '10', String(b.base?.x ?? 0), '20', String(b.base?.y ?? 0), '30', '0')
    lines.push(...b.entities.flat(), '0', 'ENDBLK')
  }
  lines.push('0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...entities.flat(), '0', 'ENDSEC', '0', 'EOF')
  return lines.join('\n')
}
