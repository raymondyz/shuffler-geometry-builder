import { orientCCW } from '../curves/outline'
import type { Segment } from '../curves/segment'
import { boreRadius, slotRadius } from '../design/hardware'
import { symmetrize } from '../design/mirror'
import type { Design } from '../design/schema'
import { distance, length, normalize, scale, type Vec2 } from '../math/vec2'
import { interpretDrawing, type Interpretation } from './dxf/entities'
import { decodeDxf, readDxf } from './dxf/reader'
import { ImportError } from './errors'
import { arcCenters, findFeatures, obroundCenter, type Features } from './features'
import { DEFAULT_GAP, findLoops, type Loop, type LoopSearch } from './loops'
import { placeFoot, symmetryError } from './place'
import { applyAffine, boundsOf, IDENTITY, mergeLoop, scaling, transformSegment, type Affine } from './segments'
import { countFacetedRuns, smoothFaceted, SMOOTH_TOL } from './simplify'
import { outlineFromSegments } from './toOutline'
import { isPlausibleSize, unitFromInsUnits, unitInfo, UNITS, type UnitId } from './units'

// Foot import from DXF (SPEC §14.2): parse once, then rebuild the preview whenever an option changes.

export { ImportError } from './errors'

export interface ParsedImport {
  fileName: string
  insUnits: number | null
  interpretation: Interpretation
}

/** Read a DXF and turn its entities into segments. Throws an ImportError for files that can't be used at all. */
export function parseDxfText(text: string, fileName: string): ParsedImport {
  const drawing = readDxf(text)
  const interpretation = interpretDrawing(drawing)
  if (interpretation.segments.length === 0) {
    const solid = ['REGION', '3DSOLID', 'BODY'].some((t) => interpretation.ignored.has(t))
    throw new ImportError(
      solid
        ? 'The drawing stores the shape as a solid. Export a sketch or flat profile instead.'
        : 'The drawing has no lines, arcs or curves to import.',
    )
  }
  return { fileName, insUnits: drawing.insUnits, interpretation }
}

export const parseDxfFile = (bytes: Uint8Array, fileName: string): ParsedImport => parseDxfText(decodeDxf(bytes), fileName)

export interface ImportOptions {
  /** Drawing unit; null uses the file's, or a guess */
  units: UnitId | null
  includeHidden: boolean
  /** Index into the preview's parts; null picks automatically */
  part: number | null
  /** Gaps up to this are closed (mm) */
  gap: number
  rotation: number
  flip: boolean
  /** P1 picked by hand, in drawing millimetres */
  pickedP1: Vec2 | null
  /** Keep the design's L and pin even when the file's slot differs */
  keepMechanism: boolean
  smooth: boolean
  makeSymmetric: boolean
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  units: null,
  includeHidden: false,
  part: null,
  gap: DEFAULT_GAP,
  rotation: 0,
  flip: false,
  pickedP1: null,
  keepMechanism: false,
  smooth: true,
  makeSymmetric: false,
}

/** What a slot and bore say about the mechanism, as a CAD user would measure them */
export interface MechanismValues {
  pinDistance: number
  L: number
  slotWidth: number
  boreDiameter: number
}

export interface PreviewPart {
  outline: Segment[]
  holes: Segment[][]
}

/** Everything the import dialog shows. Geometry is in the foot frame, in mm. */
export interface ImportPreview {
  /** Why nothing can be imported, if so */
  error: string | null
  units: UnitId
  unitsGuessed: boolean
  unitsWarning: string | null
  /** Width and height of the foot */
  size: Vec2 | null
  parts: PreviewPart[]
  part: number | null
  /** Several shapes could be the foot: ask the user to click one */
  partAmbiguous: boolean
  loose: Segment[]
  openEnds: Vec2[]
  suggestedGap: number | null
  needsP1: boolean
  slotFixed: boolean
  snapPoints: Vec2[]
  /** Foot frame → drawing mm, for points picked in the preview */
  toDrawing: Affine
  /** The file's slot and bore next to the design's, when they differ */
  mechanism: { file: MechanismValues; design: MechanismValues } | null
  faceted: { runs: number; lines: number } | null
  symmetric: boolean
  /** Largest left/right difference when the foot is almost but not quite symmetric */
  nearSymmetry: number | null
  hiddenCount: number
  /** The design Import applies */
  design: Design | null
  anchors: number
  notes: string[]
}

const MATCH_TOL = 0.05
const EXACT_SYMMETRY = 0.005
const NEAR_SYMMETRY = 0.2
const MAX_ANCHORS = 400
const BORE_MATCH = 0.02

interface Part {
  loop: Loop
  holes: Loop[]
  features: Features
  score: number
}

interface FootSearch {
  search: LoopSearch
  parts: Part[]
  chosen: number | null
  ambiguous: boolean
}

/** Score: bore with a slot lined up through it, then any bore and slot, then a bore alone. */
function scoreOf(f: Features): number {
  if (f.bore && f.slot) return f.slotOffset ? 2 : 3
  return f.bore ? 1 : 0
}

function searchFoot(segments: Segment[], gap: number, requested: number | null): FootSearch {
  const search = findLoops(segments, gap)
  const parts: Part[] = []
  search.loops.forEach((loop, i) => {
    if (loop.depth % 2 !== 0) return
    const holes = search.loops.filter((h) => h.parent === i && h.depth % 2 === 1)
    const features = findFeatures(holes)
    parts.push({ loop, holes, features, score: scoreOf(features) })
  })
  if (parts.length === 0) return { search, parts, chosen: null, ambiguous: false }
  // Parts are largest first, so ties go to the larger one
  let best = 0
  parts.forEach((p, i) => {
    if (p.score > parts[best].score) best = i
  })
  const clear = parts.length === 1 || (parts[best].score >= 2 && parts.filter((p) => p.score === parts[best].score).length === 1)
  const chosen = requested !== null && requested >= 0 && requested < parts.length ? requested : best
  return { search, parts, chosen, ambiguous: !clear }
}

const scaled = (segments: Segment[], k: number): Segment[] => (k === 1 ? segments : segments.flatMap((s) => transformSegment(s, scaling(k), 1e-3)))

const sizeOf = (loop: Loop): Vec2 => ({ x: loop.bounds.max.x - loop.bounds.min.x, y: loop.bounds.max.y - loop.bounds.min.y })

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Plain names for skipped entity types: [one, many] */
const ENTITY_NAMES: Record<string, [string, string]> = {
  TEXT: ['text', 'texts'],
  MTEXT: ['text', 'texts'],
  DIMENSION: ['dimension', 'dimensions'],
  HATCH: ['hatch', 'hatches'],
  POINT: ['point', 'points'],
  LEADER: ['leader', 'leaders'],
  MLEADER: ['leader', 'leaders'],
}

function ignoredNote(ignored: Map<string, number>): string | null {
  const counts = new Map<string, { n: number; names: [string, string] }>()
  for (const [type, n] of ignored) {
    const names = ENTITY_NAMES[type] ?? [type, type]
    const entry = counts.get(names[0]) ?? { n: 0, names }
    counts.set(names[0], { n: entry.n + n, names })
  }
  if (counts.size === 0) return null
  const list = [...counts.values()].map(({ n, names }) => plural(n, names[0], names[1]))
  return `Ignored ${list.join(', ')}: only lines, arcs, circles, polylines, splines and ellipses are read.`
}

const mm = (v: number) => `${v.toFixed(2)} mm`

/** The foot, placed and ready to import, plus everything the dialog needs to explain and adjust it (SPEC §14.2–14.10). */
export function previewImport(parsed: ParsedImport, base: Design, options: ImportOptions, fmt: (mm: number) => string = mm): ImportPreview {
  const it = parsed.interpretation
  const notes: string[] = []
  const declared = unitFromInsUnits(parsed.insUnits)
  const empty: ImportPreview = {
    error: null,
    units: options.units ?? declared ?? 'mm',
    unitsGuessed: false,
    unitsWarning: null,
    size: null,
    parts: [],
    part: null,
    partAmbiguous: false,
    loose: [],
    openEnds: [],
    suggestedGap: null,
    needsP1: false,
    slotFixed: false,
    snapPoints: [],
    toDrawing: IDENTITY,
    mechanism: null,
    faceted: null,
    symmetric: false,
    nearSymmetry: null,
    hiddenCount: it.segments.filter((s) => s.hidden).length,
    design: null,
    anchors: 0,
    notes,
  }

  // Which entities: visible ones in model space (paper space only if model space is empty)
  const visible = it.segments.filter((s) => options.includeHidden || !s.hidden)
  const model = visible.filter((s) => !s.paper)
  const usePaper = model.length === 0 && visible.length > 0
  const pool = usePaper ? visible : model
  if (pool.length === 0) return { ...empty, error: 'Everything in the drawing is on layers that are off or frozen.' }
  if (usePaper) notes.push('Model space is empty, so the paper space (sheet) geometry was used.')
  const footLayer = pool.filter((s) => s.layer.toUpperCase() === 'FOOT').map((s) => s.seg)
  const all = pool.map((s) => s.seg)

  const run = (k: number): FootSearch & { footLayer: boolean } => {
    if (footLayer.length > 0 && footLayer.length < all.length) {
      const foot = searchFoot(scaled(footLayer, k), options.gap, options.part)
      if (foot.parts.length > 0) return { ...foot, footLayer: true }
    }
    return { ...searchFoot(scaled(all, k), options.gap, options.part), footLayer: false }
  }

  // Units: the user's choice, else the file's, else a guess from the bore and the size
  let units = options.units ?? declared
  let unitsGuessed = false
  let found: ReturnType<typeof run> | null = null
  if (!units) {
    unitsGuessed = true
    found = run(1)
    const part = found.chosen !== null ? found.parts[found.chosen] : null
    const bore = part?.features.bore?.radius
    const target = boreRadius(base)
    const size = part ? Math.max(sizeOf(part.loop).x, sizeOf(part.loop).y) : 0
    if (bore && Math.abs(bore - target) <= BORE_MATCH * target) units = 'mm'
    else if (bore && Math.abs(bore * 25.4 - target) <= BORE_MATCH * target) units = 'in'
    else units = !isPlausibleSize(size) && isPlausibleSize(size * 25.4) ? 'in' : 'mm'
  }
  const k = unitInfo(units).mm
  if (!found || k !== 1) found = run(k)
  const { search, parts, chosen } = found
  if (found.footLayer) notes.push('Used the FOOT layer only.')

  const result: ImportPreview = {
    ...empty,
    units,
    unitsGuessed,
    loose: search.loose,
    openEnds: search.openEnds,
    suggestedGap: search.suggestedGap,
  }
  if (chosen === null) {
    const n = search.openEnds.length
    return {
      ...result,
      error: n > 0
        ? `The drawing has no closed outline: ${plural(n, 'end')} ${n === 1 ? "doesn't" : "don't"} meet another end (marked in red).`
        : 'The drawing has no closed outline.',
    }
  }

  const part = parts[chosen]
  const { bore, slot, slotOffset, others } = part.features
  const largest = Math.max(sizeOf(part.loop).x, sizeOf(part.loop).y)
  if (!isPlausibleSize(largest)) {
    const alternatives = UNITS.filter((u) => u.id === 'mm' || u.id === 'in').filter((u) => u.id !== units && isPlausibleSize((largest / k) * u.mm))
    const alt = alternatives[0]
    result.unitsWarning = alt
      ? `This foot is ${fmt(largest)} across. Was it drawn in ${alt.name}? It would be ${fmt((largest / k) * alt.mm)}.`
      : `This foot is ${fmt(largest)} across, which seems unlikely. Check the units.`
  }

  // Placement into the foot frame
  const placement = placeFoot(part.loop, bore, slot, options)
  const place = (segments: Segment[]) => segments.flatMap((s) => transformSegment(s, placement.toFoot, 1e-3))
  const placedParts = parts.map((p) => ({ outline: place(p.loop.segments), holes: p.holes.map((h) => place(h.segments)) }))
  const placedBounds = boundsOf(placedParts[chosen].outline)
  const shown: ImportPreview = {
    ...result,
    size: { x: placedBounds.max.x - placedBounds.min.x, y: placedBounds.max.y - placedBounds.min.y },
    parts: placedParts,
    part: chosen,
    partAmbiguous: found.ambiguous && options.part === null,
    loose: place(search.loose),
    openEnds: search.openEnds.map((p) => applyAffine(placement.toFoot, p)),
    needsP1: placement.needsP1,
    slotFixed: placement.slotFixed,
    snapPoints: [part.loop, ...part.holes].flatMap(arcCenters).map((p) => applyAffine(placement.toFoot, p)),
    toDrawing: placement.toDrawing,
  }

  // The file's slot and bore against the design
  let design: Design = base
  if (bore && slot && !slotOffset) {
    const file: MechanismValues = {
      pinDistance: distance(bore.center, obroundCenter(slot)),
      L: distance(slot.c1, slot.c2) / 2,
      slotWidth: 2 * slot.radius,
      boreDiameter: 2 * bore.radius,
    }
    const current: MechanismValues = {
      pinDistance: length(base.constraint.pin),
      L: base.drive.L,
      slotWidth: 2 * slotRadius(base.hardware),
      boreDiameter: 2 * boreRadius(base),
    }
    const differs =
      Math.abs(file.pinDistance - current.pinDistance) > MATCH_TOL ||
      Math.abs(file.L - current.L) > MATCH_TOL ||
      Math.abs(file.slotWidth - current.slotWidth) > 2 * MATCH_TOL
    if (differs) {
      shown.mechanism = { file, design: current }
      if (!options.keepMechanism) {
        const dir = length(base.constraint.pin) > 0 ? normalize(base.constraint.pin) : { x: 0, y: 1 }
        const clearance = base.hardware.clearance
        design = {
          ...base,
          drive: { ...base.drive, L: file.L },
          constraint: { ...base.constraint, pin: scale(dir, file.pinDistance) },
          hardware: { ...base.hardware, pinDiameter: Math.max(0.1, file.slotWidth - 2 * clearance) },
        }
      }
    }
    const toolBore = 2 * boreRadius(design)
    if (Math.abs(toolBore - file.boreDiameter) > 2 * MATCH_TOL) {
      notes.push(
        `The bore in the file is Ø${fmt(file.boreDiameter)}; this tool sizes it from L, the shaft and the minimum wall (Ø${fmt(toolBore)}) and uses that in the analysis and exports.`,
      )
    }
  }
  if (slotOffset) {
    notes.push(`The slot is ${fmt(slotOffset.distance)} off the bore's centreline. This tool models a centreline slot, so the file's slot was only used to orient the foot.`)
  }
  if (others > 0) {
    notes.push(`${plural(others, 'other hole')} ${others === 1 ? "isn't" : "aren't"} modelled and won't be in exports. Keep ${others === 1 ? 'it' : 'them'} in your CAD file.`)
  }
  if (!bore && !placement.needsP1 && !options.pickedP1) notes.push('No round bore was found, so P1 is at the drawing origin.')

  // The outline itself
  let segments = mergeLoop(orientCCW(place(part.loop.segments)))
  const facets = countFacetedRuns(segments)
  if (facets.runs > 0) {
    shown.faceted = facets
    if (options.smooth) {
      const smoothed = smoothFaceted(segments)
      segments = smoothed.segments
      notes.push(
        `Smoothed ${plural(smoothed.runs, 'faceted curve')} (${smoothed.lines} lines → ${plural(smoothed.curves, 'curve')}, within ${fmt(SMOOTH_TOL)}).`,
      )
    }
  }
  const asymmetry = symmetryError(segments, { x: 0, y: 0 }, { x: 0, y: 1 }, NEAR_SYMMETRY)
  const symmetric = asymmetry <= EXACT_SYMMETRY || (asymmetry <= NEAR_SYMMETRY && options.makeSymmetric)
  if (asymmetry > EXACT_SYMMETRY && asymmetry <= NEAR_SYMMETRY) shown.nearSymmetry = asymmetry
  const outline = outlineFromSegments(segments)
  const mirrored = symmetric ? symmetrize(outline) : null
  shown.symmetric = mirrored !== null
  shown.anchors = (mirrored ?? outline).nodes.length
  if (shown.anchors > MAX_ANCHORS) notes.push(`The outline has ${shown.anchors} anchors, so editing and analysis will be slow.`)

  // Housekeeping notes
  const s = search
  if (s.gapsClosed > 0) notes.push(`Closed ${plural(s.gapsClosed, 'small gap')} (largest ${fmt(s.largestGap)}).`)
  if (s.duplicates > 0) notes.push(`Removed ${plural(s.duplicates, 'duplicate line or curve', 'duplicate lines and curves')}.`)
  if (s.merged > 0) notes.push(`Merged ${plural(s.merged, 'overlapping line or arc', 'overlapping lines and arcs')}.`)
  if (s.internal > 0) notes.push(`Dropped ${plural(s.internal, 'line')} inside an outline that split it.`)
  if (s.loose.length - s.internal > 0) notes.push(`Ignored ${plural(s.loose.length - s.internal, 'loose line or curve', 'loose lines and curves')} that don't close a shape.`)
  if (it.approximated > 0) notes.push(`Fitted ${plural(it.approximated, 'curve')} that ${it.approximated === 1 ? 'has' : 'have'} no exact arc or Bézier form, to within 0.001 mm.`)
  const ignored = ignoredNote(it.ignored)
  if (ignored) notes.push(ignored)
  if (shown.hiddenCount > 0 && !options.includeHidden) notes.push(`Skipped ${plural(shown.hiddenCount, 'line or curve', 'lines and curves')} on layers that are off or frozen.`)
  if (it.tilted > 0) notes.push(`Skipped ${plural(it.tilted, 'entity', 'entities')} that ${it.tilted === 1 ? "isn't" : "aren't"} flat in the XY plane.`)
  if (it.invalid > 0) notes.push(`Skipped ${plural(it.invalid, 'entity', 'entities')} with invalid data.`)
  if (it.missingBlocks.length > 0) notes.push(`Skipped references to missing blocks: ${it.missingBlocks.join(', ')}.`)
  if (it.deepBlocks > 0) notes.push(`Skipped ${plural(it.deepBlocks, 'block reference')} nested too deeply or in a loop.`)
  if (it.zMax - it.zMin > 1e-6) notes.push('The drawing has entities at different heights; everything was projected onto XY.')

  if (placement.needsP1) return { ...shown, design: null }
  return { ...shown, design: { ...design, foot: { outline: mirrored ?? outline, mirror: mirrored !== null } } }
}
