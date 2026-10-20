import type { Design, Hardware } from './schema'

// Derived hardware sizes (mm). The cam disc is not an input: it is always just big enough.

/** Radius of the shaft hole in the cam: hex circumradius (corners) or round radius, plus clearance. */
export function shaftClearRadius(h: Hardware): number {
  const r = h.shaft.kind === 'hex' ? h.shaft.size / Math.sqrt(3) : h.shaft.size / 2
  return r + h.clearance
}

/** Cam disc radius, sized automatically: eccentricity + shaft hole + minimum wall as margin. */
export const camRadius = ({ drive, hardware }: Pick<Design, 'drive' | 'hardware'>): number =>
  drive.L + shaftClearRadius(hardware) + hardware.minWall

/** Bearing hole in the foot: the cam disc plus clearance. */
export const boreRadius = (design: Pick<Design, 'drive' | 'hardware'>): number => camRadius(design) + design.hardware.clearance

/** Slot half-width: pin radius plus clearance. */
export const slotRadius = (h: Hardware): number => h.pinDiameter / 2 + h.clearance
