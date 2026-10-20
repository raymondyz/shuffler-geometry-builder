import type { Outline } from '../../../core/curves/outline'
import type { Vec2 } from '../../../core/math/vec2'
import { updateDesign } from '../../../state/designStore'

/** Apply a pure outline edit to the current design (one undo step, or part of the current gesture). */
export const updateOutline = (fn: (outline: Outline) => Outline): void =>
  updateDesign((d) => {
    const outline = fn(d.foot.outline)
    return outline === d.foot.outline ? d : { ...d, foot: { ...d.foot, outline } }
  })

export const snapTo = (p: Vec2, step: number): Vec2 => ({ x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step })
