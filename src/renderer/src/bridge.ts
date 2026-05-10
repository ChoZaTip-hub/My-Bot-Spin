import type { AppSettings } from '@modules/shared/ipc-contract'
import type { AssistSnapshot } from '@modules/shared/assist-snapshot'
import type { SpinAnalyticsSummary } from '@modules/shared/sector-analytics'

export type RendererApi = {
  settings: {
    get: () => Promise<AppSettings>
    set: (partial: Partial<AppSettings>) => Promise<AppSettings>
  }
  strategies: {
    list: () => Promise<{ id: string; name: string; updatedAt: number }[]>
    get: (id: string) => Promise<unknown>
    save: (cfg: unknown) => Promise<{ ok: true }>
    delete: (id: string) => Promise<{ ok: true }>
    validate: (cfg: unknown) => Promise<
      { ok: true; data: unknown } | { ok: false; errors: Record<string, unknown> }
    >
  }
  simulation: {
    run: (req: unknown) => Promise<unknown>
    runHistorical: (req: unknown) => Promise<unknown>
    get: (id: string) => Promise<unknown>
    exportCsv: (rows: { bankroll: number }[]) => Promise<string>
  }
  session: {
    start: (req: unknown) => Promise<{ sessionId: string }>
    stop: () => Promise<{ ok: true }>
    pause: () => Promise<{ ok: true }>
    resume: () => Promise<{ ok: true }>
    timeline: () => Promise<unknown[]>
    status: () => Promise<{ sessionId: string | null; pending: unknown }>
    confirm: (payload: unknown) => Promise<{ ok: true }>
  }
  browser: {
    launch: (url?: string) => Promise<{ ok: true }>
    close: () => Promise<{ ok: true }>
  }
  import: {
    spinsCsv: (filePath: string) => Promise<{ jobId: string; spins: number[] }>
  }
  dialog: {
    pickCsv: () => Promise<string | null>
  }
  logs: {
    query: (filter: { level?: string; limit?: number }) => Promise<
      { id: string; level: string; message: string; at: number }[]
    >
  }
  analytics: {
    overview: () => Promise<{
      summary: SpinAnalyticsSummary
      recentSpinsDesc: number[]
      spinTotal: number
      /** Spins recorded across all observer-mode sessions (same rows as DB `spins`). */
      observerSpinTotal: number
    }>
  }
  assist: {
    open: () => Promise<{ ok: true }>
    getState: () => Promise<AssistSnapshot>
  }
  feedTables: {
    list: () => Promise<{ id: string; name: string; updatedAt: number }[]>
    get: (id: string) => Promise<{ id: string; name: string; mappingJson: string } | null>
    save: (req: unknown) => Promise<{ id: string }>
    delete: (id: string) => Promise<{ ok: boolean }>
  }
  teaching: {
    start: () => Promise<{ ok: true } | { ok: false; error: string }>
    stop: () => Promise<{ ok: true } | { ok: false; error: string }>
    events: () => Promise<unknown[]>
    clear: () => Promise<{ ok: true }>
    save: (filename?: string) => Promise<{ path: string }>
    status: () => Promise<{ recording: boolean; eventCount: number }>
    saveMapping: (key: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  }
  onTeachingEvent: (cb: (e: unknown) => void) => () => void
  onTimeline: (cb: (e: unknown) => void) => () => void
  onLogLine: (cb: (e: unknown) => void) => () => void
}

export function getApi(): RendererApi {
  return window.rsa as RendererApi
}
