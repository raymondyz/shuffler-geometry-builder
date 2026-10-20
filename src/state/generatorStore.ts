import { create } from 'zustand'
import type { Analysis } from '../core/analysis/analyze'
import { createBrief, type Brief } from '../core/generate/brief'
import type { Candidate } from '../core/generate/search'
import type { Design } from '../core/design/schema'
import type { GenerateMessage, GenerateRequest } from '../workers/generateProtocol'
import { useDesignStore } from './designStore'
import { readStorage, writeStorage } from './storage'
import { useUiStore } from './uiStore'

export type GeneratorStatus = 'idle' | 'running' | 'done' | 'error'

interface GeneratorState {
  /** What the generator may change and must respect; remembered in the browser */
  brief: Brief | null
  status: GeneratorStatus
  /** 0–1 while running */
  progress: number
  candidates: Candidate[]
  /** Index of the candidate previewed in the views */
  selected: number | null
  note: string | null
  updateBrief(update: (brief: Brief) => Brief): void
  /** Starts a brief from the current design if there isn't one */
  ensureBrief(design: Design, analysis: Analysis): void
  resetBrief(design: Design, analysis: Analysis): void
  run(): void
  stop(): void
  select(index: number | null): void
  /** Replaces the design with the selected candidate (one undo step) and returns to the design view */
  apply(): void
}

const BRIEF_KEY = 'shuffler-geometry-builder:brief:v1'

function loadBrief(): Brief | null {
  try {
    const raw = readStorage(BRIEF_KEY)
    const brief = raw ? (JSON.parse(raw) as Brief) : null
    // Accept only briefs with the current shape; anything else starts fresh from the design
    return brief && Array.isArray(brief.feet) && brief.goals?.bob && brief.space ? brief : null
  } catch {
    return null
  }
}

let worker: Worker | null = null
let requestId = 0

function getWorker(onMessage: (m: GenerateMessage) => void): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/generate.worker.ts', import.meta.url), { type: 'module' })
  }
  worker.onmessage = (e: MessageEvent<GenerateMessage>) => onMessage(e.data)
  return worker
}

export const useGeneratorStore = create<GeneratorState>()((set, get) => {
  const saveBrief = (brief: Brief) => {
    set({ brief })
    writeStorage(BRIEF_KEY, JSON.stringify(brief))
  }

  const onMessage = (m: GenerateMessage) => {
    if (m.id !== requestId) return
    if (m.type === 'progress') set({ progress: m.total > 0 ? m.done / m.total : 0 })
    else if (m.type === 'candidates' || m.type === 'done') {
      const { selected } = get()
      set({
        candidates: m.candidates,
        selected: m.candidates.length === 0 ? null : selected !== null && selected < m.candidates.length ? selected : 0,
        ...(m.type === 'done' ? { status: 'done' as const, progress: 1, note: m.note } : {}),
      })
    } else {
      set({ status: 'error', note: `The generator stopped with an error: ${m.message}` })
    }
  }

  return {
    brief: loadBrief(),
    status: 'idle',
    progress: 0,
    candidates: [],
    selected: null,
    note: null,
    updateBrief(update) {
      const { brief } = get()
      if (brief) saveBrief(update(brief))
    },
    ensureBrief(design, analysis) {
      if (!get().brief) saveBrief(createBrief(design, analysis))
    },
    resetBrief(design, analysis) {
      saveBrief(createBrief(design, analysis))
    },
    run() {
      const { brief } = get()
      if (!brief) return
      const request: GenerateRequest = { id: ++requestId, base: useDesignStore.getState().design, brief }
      set({ status: 'running', progress: 0, candidates: [], selected: null, note: null })
      getWorker(onMessage).postMessage(request)
    },
    stop() {
      worker?.terminate()
      worker = null
      requestId++
      set({ status: get().candidates.length > 0 ? 'done' : 'idle', progress: 0 })
    },
    select(index) {
      set({ selected: index })
    },
    apply() {
      const { candidates, selected } = get()
      const candidate = selected !== null ? candidates[selected] : undefined
      if (!candidate) return
      useDesignStore.getState().update((d) => ({ ...candidate.design, name: d.name }))
      useUiStore.getState().setMode('design')
    },
  }
})

/** The design shown in the views: the selected candidate while generating, else the real design. */
export function usePreviewDesign(): Design | null {
  const mode = useUiStore((s) => s.mode)
  return useGeneratorStore((s) => (mode === 'generate' && s.selected !== null ? s.candidates[s.selected]?.design ?? null : null))
}
