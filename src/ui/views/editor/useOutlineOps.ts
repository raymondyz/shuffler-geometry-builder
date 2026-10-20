import { outlineOps } from '../../../core/design/mirror'
import type { OutlineOps } from '../../../core/design/outlineEdit'
import { useDesignStore } from '../../../state/designStore'

/** Editing operations for the current mode: mirrored edits when Mirror is on, free edits otherwise. */
export function useOutlineOps(): OutlineOps {
  const mirror = useDesignStore((s) => s.design.foot.mirror)
  return outlineOps(mirror)
}
