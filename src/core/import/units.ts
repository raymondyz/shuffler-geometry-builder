// Drawing units (SPEC §14.4). $INSUNITS codes from the DXF reference.

export type UnitId = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'mil' | 'um'

export interface UnitInfo {
  id: UnitId
  label: string
  /** For sentences: "drawn in inches" */
  name: string
  /** Millimetres per drawing unit */
  mm: number
  insUnits: number
}

export const UNITS: UnitInfo[] = [
  { id: 'mm', label: 'mm', name: 'millimetres', mm: 1, insUnits: 4 },
  { id: 'cm', label: 'cm', name: 'centimetres', mm: 10, insUnits: 5 },
  { id: 'm', label: 'm', name: 'metres', mm: 1000, insUnits: 6 },
  { id: 'in', label: 'in', name: 'inches', mm: 25.4, insUnits: 1 },
  { id: 'ft', label: 'ft', name: 'feet', mm: 304.8, insUnits: 2 },
  { id: 'mil', label: 'mil', name: 'mils', mm: 0.0254, insUnits: 9 },
  { id: 'um', label: 'µm', name: 'micrometres', mm: 0.001, insUnits: 13 },
]

export const unitInfo = (id: UnitId): UnitInfo => UNITS.find((u) => u.id === id)!

/** The declared unit, or null for unitless, missing or unsupported codes. */
export const unitFromInsUnits = (code: number | null): UnitId | null => UNITS.find((u) => u.insUnits === code)?.id ?? null

/** A believable size for a shuffler foot (largest dimension, mm) */
export const isPlausibleSize = (mm: number): boolean => mm >= 5 && mm <= 1000
