import type { Outline } from '../curves/outline'
import type { ConstraintSpec } from '../mechanism/constraints/registry'

export const SCHEMA_VERSION = 1

/** Hex size is across flats; round size is the diameter. */
export interface ShaftSpec {
  kind: 'hex' | 'round'
  size: number
}

/** Physical sizes. The cam disc diameter is derived (see ./hardware), not stored. */
export interface Hardware {
  shaft: ShaftSpec
  pinDiameter: number
  /** Radial clearance added to every bore and slot */
  clearance: number
  /** Minimum material around every hole; also the cam's margin around the shaft */
  minWall: number
}

/** Everything that defines a shuffler module. All lengths are millimetres, all angles radians. */
export interface Design {
  schemaVersion: typeof SCHEMA_VERSION
  /** User-facing name, also used for file names */
  name: string
  units: 'mm'
  feet: { count: number }
  drive: { kind: 'eccentric'; L: number }
  constraint: ConstraintSpec
  /** `mirror` keeps the outline symmetric about the foot centreline (see ./mirror) */
  foot: { outline: Outline; mirror: boolean }
  hardware: Hardware
  operating: { shaftRpm: number }
}

export const DEFAULT_NAME = 'Untitled shuffler'

export const MIN_FEET = 2
export const MAX_FEET = 8
