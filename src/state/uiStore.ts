import { create } from 'zustand'
import type { Units } from '../ui/format'
import { readStorage, writeStorage } from './storage'

export type EditorSelection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; index: number }
  | null

export type ChartRange = 'full' | 'envelope'

export interface Notice {
  id: number
  level: 'info' | 'error'
  text: string
}

interface Preferences {
  units: Units
  showAllFeet: boolean
  showSwept: boolean
  snap: boolean
  chartRange: ChartRange
}

export type DialogId = 'save'

/** Design: edit the current design. Generate: describe constraints and pick a generated design (SPEC §13.6). */
export type AppMode = 'design' | 'generate'

interface UiState extends Preferences {
  mode: AppMode
  setMode(mode: AppMode): void
  selection: EditorSelection
  notice: Notice | null
  dialog: DialogId | null
  openDialog(dialog: DialogId): void
  closeDialog(): void
  setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void
  select(selection: EditorSelection): void
  notify(level: Notice['level'], text: string): void
  dismissNotice(): void
}

const PREFS_KEY = 'shuffler-geometry-builder:prefs:v1'

const defaults: Preferences = { units: 'mm', showAllFeet: false, showSwept: false, snap: true, chartRange: 'full' }

function loadPreferences(): Preferences {
  try {
    const raw = readStorage(PREFS_KEY)
    const saved = raw ? (JSON.parse(raw) as Partial<Preferences>) : {}
    return {
      units: saved.units === 'in' ? 'in' : 'mm',
      showAllFeet: typeof saved.showAllFeet === 'boolean' ? saved.showAllFeet : defaults.showAllFeet,
      showSwept: typeof saved.showSwept === 'boolean' ? saved.showSwept : defaults.showSwept,
      snap: typeof saved.snap === 'boolean' ? saved.snap : defaults.snap,
      chartRange: saved.chartRange === 'envelope' ? 'envelope' : 'full',
    }
  } catch {
    return defaults
  }
}

let noticeId = 0
let noticeTimer: ReturnType<typeof setTimeout> | undefined

export const useUiStore = create<UiState>()((set, get) => ({
  ...loadPreferences(),
  mode: 'design',
  setMode(mode) {
    set({ mode, selection: null })
  },
  selection: null,
  notice: null,
  dialog: null,
  openDialog(dialog) {
    set({ dialog })
  },
  closeDialog() {
    set({ dialog: null })
  },
  setPreference(key, value) {
    set({ [key]: value } as Pick<Preferences, typeof key>)
    const { units, showAllFeet, showSwept, snap, chartRange } = get()
    writeStorage(PREFS_KEY, JSON.stringify({ units, showAllFeet, showSwept, snap, chartRange }))
  },
  select(selection) {
    set({ selection })
  },
  notify(level, text) {
    clearTimeout(noticeTimer)
    set({ notice: { id: ++noticeId, level, text } })
    noticeTimer = setTimeout(() => set({ notice: null }), 5000)
  },
  dismissNotice() {
    set({ notice: null })
  },
}))

export const useUnits = (): Units => useUiStore((s) => s.units)
