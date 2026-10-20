import { create } from 'zustand'
import { createDefaultDesign } from '../core/design/defaults'
import type { Design } from '../core/design/schema'
import { parseDesign, serializeDesign } from '../core/design/serialize'
import { readStorage, writeStorage } from './storage'

const STORAGE_KEY = 'shuffler-geometry-builder:design:v1'
const HISTORY_LIMIT = 200

interface DesignState {
  design: Design
  past: Design[]
  future: Design[]
  /** True while a drag or slider gesture is in progress: its updates share one undo step */
  inGesture: boolean
  update(fn: (design: Design) => Design): void
  replace(design: Design): void
  beginGesture(): void
  endGesture(): void
  undo(): void
  redo(): void
}

function loadInitialDesign(): Design {
  const saved = readStorage(STORAGE_KEY)
  if (saved) {
    try {
      return parseDesign(saved)
    } catch {
      // Fall through to the default design
    }
  }
  return createDefaultDesign()
}

const pushPast = (past: Design[], design: Design) => [...past, design].slice(-HISTORY_LIMIT)

export const useDesignStore = create<DesignState>()((set, get) => ({
  design: loadInitialDesign(),
  past: [],
  future: [],
  inGesture: false,
  update(fn) {
    const { design, past, inGesture } = get()
    const next = fn(design)
    if (next === design) return
    if (inGesture) set({ design: next })
    else set({ design: next, past: pushPast(past, design), future: [] })
  },
  replace(design) {
    const { design: current, past } = get()
    set({ design, past: pushPast(past, current), future: [], inGesture: false })
  },
  beginGesture() {
    const { design, past, inGesture } = get()
    if (inGesture) return
    set({ inGesture: true, past: pushPast(past, design), future: [] })
  },
  endGesture() {
    const { past, design, inGesture } = get()
    if (!inGesture) return
    // Drop the history entry if the gesture did not change anything
    if (past[past.length - 1] === design) set({ inGesture: false, past: past.slice(0, -1) })
    else set({ inGesture: false })
  },
  undo() {
    const { past, future, design } = get()
    if (past.length === 0) return
    set({ design: past[past.length - 1], past: past.slice(0, -1), future: [design, ...future], inGesture: false })
  },
  redo() {
    const { past, future, design } = get()
    if (future.length === 0) return
    set({ design: future[0], past: pushPast(past, design), future: future.slice(1), inGesture: false })
  },
}))

/** Shorthand for one undoable change from anywhere (event handlers, menus). */
export const updateDesign = (fn: (design: Design) => Design): void => useDesignStore.getState().update(fn)

/** Spread onto a NumberField so a slider drag becomes a single undo step. */
export const gestureProps = {
  onGestureStart: () => useDesignStore.getState().beginGesture(),
  onGestureEnd: () => useDesignStore.getState().endGesture(),
}

// Autosave, debounced so drags do not hammer storage
let saveTimer: ReturnType<typeof setTimeout> | undefined
useDesignStore.subscribe((state, prev) => {
  if (state.design === prev.design) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => writeStorage(STORAGE_KEY, serializeDesign(useDesignStore.getState().design)), 400)
})
