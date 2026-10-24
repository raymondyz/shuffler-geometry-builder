import type { Vec2 } from '../../math/vec2'
import { ImportError } from '../errors'

// ASCII DXF is a flat list of (group code, value) line pairs, grouped into sections and records that
// each start with code 0 (SPEC §14.3). Only what the importer needs is kept.

export type DxfPair = [code: number, value: string]

/** One record (entity, block header, table entry): its type and raw pairs in file order. */
export interface DxfRecord {
  type: string
  codes: DxfPair[]
  /** The VERTEX records of a POLYLINE */
  vertices?: DxfRecord[]
}

export interface DxfLayer {
  name: string
  /** Off (negative colour) or frozen */
  hidden: boolean
}

export interface DxfBlock {
  name: string
  base: Vec2
  entities: DxfRecord[]
}

export interface DxfDrawing {
  /** $INSUNITS, or null when the header doesn't give it */
  insUnits: number | null
  layers: Map<string, DxfLayer>
  blocks: Map<string, DxfBlock>
  entities: DxfRecord[]
}

const MAX_BYTES = 20 * 1024 * 1024

/** File bytes as text: UTF-8 (R2007 and later), falling back to Windows-1252 for older files. */
export function decodeDxf(bytes: Uint8Array): string {
  if (bytes.length > MAX_BYTES) throw new ImportError('This file is over 20 MB, so it looks like a whole drawing. Export just the foot.')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

const notDxf = () => new ImportError("This isn't a DXF file.")

function pairsOf(text: string): DxfPair[] {
  if (text.startsWith('AutoCAD Binary DXF')) throw new ImportError('This is a binary DXF. Export it as ASCII DXF.')
  if (/^AC1\d{3}/.test(text)) throw new ImportError('This is a DWG file. Export it as DXF.')
  const lines = text.split(/\r\n|\r|\n/)
  const pairs: DxfPair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const raw = lines[i].trim()
    const code = raw === '' ? NaN : Number(raw)
    if (!Number.isInteger(code)) {
      if (pairs.length === 0) throw notDxf()
      // A blank line at the very end is just a trailing newline
      if (raw === '' && lines.slice(i).every((l) => l.trim() === '')) break
      throw new ImportError(`This DXF file is damaged near line ${i + 1}.`)
    }
    const value = lines[i + 1].trim()
    if (code === 0 && value === 'EOF') break
    pairs.push([code, value])
  }
  return pairs
}

function sectionsOf(pairs: DxfPair[]): Map<string, DxfPair[]> {
  const sections = new Map<string, DxfPair[]>()
  let i = 0
  while (i < pairs.length) {
    if (pairs[i][0] === 0 && pairs[i][1] === 'SECTION') {
      const name = pairs[i + 1]?.[0] === 2 ? pairs[i + 1][1] : ''
      let j = i + 2
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === 'ENDSEC')) j++
      sections.set(name, pairs.slice(i + 2, j))
      i = j + 1
    } else {
      i++
    }
  }
  return sections
}

/** Split a section into records, each starting at a code 0 pair. */
function recordsOf(pairs: DxfPair[]): DxfRecord[] {
  const records: DxfRecord[] = []
  for (const pair of pairs) {
    if (pair[0] === 0) records.push({ type: pair[1], codes: [] })
    else records[records.length - 1]?.codes.push(pair)
  }
  return records
}

/** Attach VERTEX records to their POLYLINE and drop the SEQEND/ATTRIB records that follow polylines and inserts. */
function groupEntities(records: DxfRecord[]): DxfRecord[] {
  const out: DxfRecord[] = []
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (r.type === 'POLYLINE') {
      const vertices: DxfRecord[] = []
      while (records[i + 1]?.type === 'VERTEX') vertices.push(records[++i])
      if (records[i + 1]?.type === 'SEQEND') i++
      out.push({ ...r, vertices })
    } else if (r.type !== 'VERTEX' && r.type !== 'SEQEND' && r.type !== 'ATTRIB') {
      out.push(r)
    }
  }
  return out
}

/** First value of a group code, if present. */
export const valueOf = (r: DxfRecord, code: number): string | undefined => r.codes.find((p) => p[0] === code)?.[1]

/** Number for a group code: `fallback` when absent, NaN when present but not a finite number. */
export function numberOf(r: DxfRecord, code: number, fallback = 0): number {
  const v = valueOf(r, code)
  if (v === undefined) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

function headerUnits(pairs: DxfPair[]): number | null {
  const i = pairs.findIndex((p) => p[0] === 9 && p[1] === '$INSUNITS')
  const value = i >= 0 && pairs[i + 1]?.[0] === 70 ? Number(pairs[i + 1][1]) : NaN
  return Number.isInteger(value) ? value : null
}

function layersOf(pairs: DxfPair[]): Map<string, DxfLayer> {
  const layers = new Map<string, DxfLayer>()
  for (const r of recordsOf(pairs)) {
    if (r.type !== 'LAYER') continue
    const name = valueOf(r, 2) ?? ''
    const hidden = numberOf(r, 62, 7) < 0 || (numberOf(r, 70, 0) & 1) !== 0
    layers.set(name.toUpperCase(), { name, hidden })
  }
  return layers
}

function blocksOf(pairs: DxfPair[]): Map<string, DxfBlock> {
  const blocks = new Map<string, DxfBlock>()
  let current: { name: string; base: Vec2; records: DxfRecord[] } | null = null
  for (const r of recordsOf(pairs)) {
    if (r.type === 'BLOCK') {
      current = { name: valueOf(r, 2) ?? '', base: { x: numberOf(r, 10), y: numberOf(r, 20) }, records: [] }
    } else if (r.type === 'ENDBLK') {
      if (current) blocks.set(current.name, { name: current.name, base: current.base, entities: groupEntities(current.records) })
      current = null
    } else {
      current?.records.push(r)
    }
  }
  return blocks
}

/** Parse an ASCII DXF. Throws an ImportError with a readable message for anything that isn't one. */
export function readDxf(text: string): DxfDrawing {
  const sections = sectionsOf(pairsOf(text.replace(/^﻿/, '')))
  if (!sections.has('ENTITIES') && !sections.has('BLOCKS')) throw notDxf()
  const entities = groupEntities(recordsOf(sections.get('ENTITIES') ?? []))
  if (entities.length > 200_000) throw new ImportError('This drawing has over 200 000 entities, so it looks like a whole drawing. Export just the foot.')
  return {
    insUnits: headerUnits(sections.get('HEADER') ?? []),
    layers: layersOf(sections.get('TABLES') ?? []),
    blocks: blocksOf(sections.get('BLOCKS') ?? []),
    entities,
  }
}
