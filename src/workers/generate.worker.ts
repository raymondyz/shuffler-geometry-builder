// Runs the geometry generator (SPEC §10) off the main thread. HiGHS (WebAssembly) loads on the
// first request and is reused; stopping a run terminates the worker.
import highsLoader from 'highs'
import wasmUrl from 'highs/runtime?url'
import { createHighsSolver } from '../core/generate/highsSolver'
import type { LpSolver } from '../core/generate/lp'
import { generateDesigns } from '../core/generate/search'
import type { GenerateMessage, GenerateRequest } from './generateProtocol'

let solver: Promise<LpSolver> | null = null
const loadSolver = () => (solver ??= highsLoader({ locateFile: () => wasmUrl }).then(createHighsSolver))

const post = (message: GenerateMessage) => (self as unknown as { postMessage(m: GenerateMessage): void }).postMessage(message)

self.onmessage = async (event: MessageEvent<GenerateRequest>) => {
  const { id, base, brief } = event.data
  try {
    const lp = await loadSolver()
    let lastPost = 0
    const result = generateDesigns(base, brief, lp, {
      onProgress(done, total) {
        const now = performance.now()
        if (now - lastPost > 60 || done === total) {
          lastPost = now
          post({ id, type: 'progress', done, total })
        }
      },
      onCandidates: (candidates) => post({ id, type: 'candidates', candidates }),
    })
    post({ id, type: 'done', candidates: result.candidates, note: result.note })
  } catch (error) {
    post({ id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
