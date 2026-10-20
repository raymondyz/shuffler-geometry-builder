import type { Outline, OutlineEdge, OutlineNode } from '../curves/outline'
import type { Vec2 } from '../math/vec2'
import { symmetrize } from './mirror'
import { DEFAULT_NAME, SCHEMA_VERSION, type Design } from './schema'

export const DESIGN_FILE_EXTENSION = '.shuffler.json'

export function serializeDesign(design: Design): string {
  return `${JSON.stringify(design, null, 2)}\n`
}

class DesignFormatError extends Error {}

function fail(path: string, expected: string): never {
  throw new DesignFormatError(`Invalid design file: "${path}" should be ${expected}.`)
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a number')
  return value
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'an object')
  return value as Record<string, unknown>
}

function vec(value: unknown, path: string): Vec2 {
  const o = obj(value, path)
  return { x: num(o.x, `${path}.x`), y: num(o.y, `${path}.y`) }
}

function outlineOf(value: unknown): Outline {
  const o = obj(value, 'foot.outline')
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) fail('foot.outline', 'an object with nodes and edges arrays')
  if (o.nodes.length !== o.edges.length) fail('foot.outline.edges', 'the same length as nodes')
  const nodes: OutlineNode[] = o.nodes.map((n, i) => {
    const node = obj(n, `foot.outline.nodes[${i}]`)
    const mode = node.mode
    if (mode !== 'corner' && mode !== 'smooth' && mode !== 'symmetric') fail(`foot.outline.nodes[${i}].mode`, 'corner, smooth or symmetric')
    return {
      id: typeof node.id === 'string' ? node.id : `n${i}`,
      p: vec(node.p, `foot.outline.nodes[${i}].p`),
      hIn: vec(node.hIn, `foot.outline.nodes[${i}].hIn`),
      hOut: vec(node.hOut, `foot.outline.nodes[${i}].hOut`),
      mode,
    }
  })
  const edges: OutlineEdge[] = o.edges.map((e, i) => {
    const edge = obj(e, `foot.outline.edges[${i}]`)
    const kind = edge.kind
    if (kind !== 'cubic' && kind !== 'line' && kind !== 'arc') fail(`foot.outline.edges[${i}].kind`, 'cubic, line or arc')
    return { kind, bulge: edge.bulge === undefined ? 0 : num(edge.bulge, `foot.outline.edges[${i}].bulge`) }
  })
  return { nodes, edges }
}

/** Parse and validate a design file; throws a readable error for malformed input. */
export function parseDesign(text: string): Design {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new DesignFormatError('Invalid design file: not valid JSON.')
  }
  const d = obj(raw, 'design')
  if (d.schemaVersion !== SCHEMA_VERSION) fail('schemaVersion', String(SCHEMA_VERSION))
  const feet = obj(d.feet, 'feet')
  const drive = obj(d.drive, 'drive')
  const constraint = obj(d.constraint, 'constraint')
  if (constraint.kind !== 'centerlineSlot') fail('constraint.kind', '"centerlineSlot"')
  const foot = obj(d.foot, 'foot')
  const hardware = obj(d.hardware, 'hardware')
  const shaft = obj(hardware.shaft, 'hardware.shaft')
  if (shaft.kind !== 'hex' && shaft.kind !== 'round') fail('hardware.shaft.kind', '"hex" or "round"')
  const operating = obj(d.operating, 'operating')
  const outline = outlineOf(foot.outline)
  // A mirrored design must be in canonical symmetric form; re-derive it rather than trusting the file
  const mirrored = foot.mirror === true ? symmetrize(outline) : null
  return {
    schemaVersion: SCHEMA_VERSION,
    name: typeof d.name === 'string' && d.name.trim() ? d.name.trim() : DEFAULT_NAME,
    units: 'mm',
    feet: { count: num(feet.count, 'feet.count') },
    drive: { kind: 'eccentric', L: num(drive.L, 'drive.L') },
    constraint: { kind: 'centerlineSlot', pin: vec(constraint.pin, 'constraint.pin') },
    foot: { outline: mirrored ?? outline, mirror: mirrored !== null },
    hardware: {
      shaft: { kind: shaft.kind, size: num(shaft.size, 'hardware.shaft.size') },
      pinDiameter: num(hardware.pinDiameter, 'hardware.pinDiameter'),
      clearance: num(hardware.clearance, 'hardware.clearance'),
      minWall: num(hardware.minWall, 'hardware.minWall'),
    },
    operating: { shaftRpm: num(operating.shaftRpm, 'operating.shaftRpm') },
  }
}
