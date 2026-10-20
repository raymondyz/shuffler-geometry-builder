import type { Brief } from '../core/generate/brief'
import type { Candidate } from '../core/generate/search'
import type { Design } from '../core/design/schema'

/** Main thread → generator worker */
export interface GenerateRequest {
  id: number
  base: Design
  brief: Brief
}

/** Generator worker → main thread. Messages carry the request id so stale runs can be ignored. */
export type GenerateMessage =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'candidates'; candidates: Candidate[] }
  | { id: number; type: 'done'; candidates: Candidate[]; note: string | null }
  | { id: number; type: 'error'; message: string }
