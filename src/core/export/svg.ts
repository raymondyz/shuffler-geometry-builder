import { segmentsToPath } from '../curves/pathData'
import { LABEL_HEIGHT, partBounds, sheetBounds, type Part } from './parts'

const STROKES: Record<Part['layer'], string> = {
  foot: '#0b0b0b',
  cam: '#0b0b0b',
  frame: '#0b0b0b',
  reference: '#2a78d6',
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** SVG sheet in millimetres. Curves are exact (cubic and arc commands); y is flipped so +y is up. */
export function exportSvg(parts: Part[]): string {
  const margin = 10
  const labelSpace = 8
  const { min, max } = sheetBounds(parts)
  const width = max.x - min.x + 2 * margin
  const height = max.y - min.y + 2 * margin + labelSpace
  const flip = `matrix(1 0 0 -1 ${margin - min.x} ${margin + max.y})`
  const body = parts.map((part) => {
    const paths = part.paths.map((p) => `<path d="${segmentsToPath(p, true)}"/>`).join('')
    const circles = part.circles.map((c) => `<circle cx="${c.center.x}" cy="${c.center.y}" r="${c.radius}"/>`).join('')
    return `<g transform="translate(${part.offset.x} ${part.offset.y})" stroke="${STROKES[part.layer]}">${paths}${circles}</g>`
  }).join('\n    ')
  const labels = parts.map((part) => {
    const x = margin - min.x + partBounds(part).min.x
    return `<text x="${x}" y="${height - 3}">${esc(part.label)}</text>`
  }).join('\n  ')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
    `  <g transform="${flip}" fill="none" stroke-width="0.2">`,
    `    ${body}`,
    '  </g>',
    `  <g font-family="sans-serif" font-size="${LABEL_HEIGHT}" fill="#52514e">`,
    `  ${labels}`,
    '  </g>',
    '</svg>',
    '',
  ].join('\n')
}
