import { radToDeg } from '../core/math/angle'

// Everything is millimetres internally; these helpers convert only for display and input.

export type Units = 'mm' | 'in'

export const MM_PER_INCH = 25.4

export const unitLabel = (units: Units): string => units

export const toDisplay = (mm: number, units: Units): number => (units === 'mm' ? mm : mm / MM_PER_INCH)

export const fromDisplay = (value: number, units: Units): number => (units === 'mm' ? value : value * MM_PER_INCH)

/** Decimal places that keep roughly the same resolution in both unit systems. */
export const lengthDecimals = (units: Units): number => (units === 'mm' ? 2 : 3)

/** Input step for length fields and the editor snap grid (mm). */
export const lengthStep = (units: Units): number => (units === 'mm' ? 0.5 : MM_PER_INCH / 32)

export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '–'
  const fixed = value.toFixed(decimals)
  return fixed === `-${(0).toFixed(decimals)}` ? (0).toFixed(decimals) : fixed
}

export const formatLength = (mm: number, units: Units, decimals = lengthDecimals(units)): string =>
  `${formatNumber(toDisplay(mm, units), decimals)} ${units}`

export const formatPerRad = (mm: number, units: Units): string => `${formatLength(mm, units)}/rad`

export const formatAngle = (rad: number, decimals = 1): string => `${formatNumber(radToDeg(rad), decimals)}°`

export const formatPercent = (fraction: number, decimals = 1): string => `${formatNumber(fraction * 100, decimals)}%`

/** Ground speed: m/s for metric, ft/s for imperial. */
export function formatSpeed(mmPerSecond: number, units: Units): string {
  return units === 'mm'
    ? `${formatNumber(mmPerSecond / 1000, 2)} m/s`
    : `${formatNumber(mmPerSecond / (MM_PER_INCH * 12), 2)} ft/s`
}

/** Small velocities (impacts, scrub): mm/s or in/s. */
export const formatVelocity = (mmPerSecond: number, units: Units): string =>
  `${formatNumber(toDisplay(mmPerSecond, units), units === 'mm' ? 0 : 1)} ${units}/s`
