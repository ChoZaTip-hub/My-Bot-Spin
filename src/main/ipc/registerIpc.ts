import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Dialog, IpcMain } from 'electron'
import { desc, eq } from 'drizzle-orm'
import type { DbClient } from '@modules/db/client'
import * as schema from '@modules/db/schema'
import { StrategyConfigSchema } from '@modules/shared/strategy-config'
import { IPC_CHANNELS } from '@modules/shared/ipc-channels'
import {
  SessionConfirmPayloadSchema,
  SessionStartRequestSchema,
  SettingsSchema,
  SimulationHistoricalRequestSchema,
  SimulationRunRequestSchema,
  type AppSettings
} from '@modules/shared/ipc-contract'
import { parseSpinCsv } from '@modules/simulator/csv'
import { MockTableExecutor } from '@modules/executor/mockExecutor'
import { MockTableObserver } from '@modules/parser/mockObserver'
import { summarizeSpinAnalytics } from '@modules/shared/sector-analytics'
import type { Logger } from '../logger'
import type { BrowserHost } from '../playwright/BrowserHost'
import { GenericDomObserver } from '../playwright/GenericDomObserver'
import { GalaxsysRouletteXExecutor } from '../playwright/GalaxsysRouletteXExecutor'
import { GalaxsysRouletteXObserver } from '../playwright/GalaxsysRouletteXObserver'
import { LiveSessionController } from '../session/LiveSessionController'

/** Synthetic wheel order for mock observer (no live page). */
const EURO_WHEEL_SEQ = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9,
  22, 18, 29, 7, 28, 12, 35, 3, 26
] as const
let mockWheelCursor = 0

const DEFAULT_SETTINGS: AppSettings = SettingsSchema.parse({})

function isGalaxsysRouletteXUrl(url?: string): boolean {
  if (!url) return false
  return /fresh\.casino\/table\/galaxsys-roulettex/i.test(url)
}

async function readSettings(db: DbClient['db']): Promise<AppSettings> {
  const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, 'app'))
  if (!rows.length) return DEFAULT_SETTINGS
  const raw = JSON.parse(rows[0]!.valueJson) as unknown
  return SettingsSchema.parse(raw)
}

async function writeSettings(db: DbClient['db'], s: AppSettings): Promise<void> {
  const now = new Date()
  await db
    .insert(schema.settings)
    .values({ key: 'app', valueJson: JSON.stringify(s), updatedAt: now })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { valueJson: JSON.stringify(s), updatedAt: now }
    })
}

export function registerIpc(deps: {
  db: DbClient['db']
  logger: Logger
  browserHost: BrowserHost
  live: LiveSessionController
  ipcMain: IpcMain
  dialog: Dialog
}): void {
  const { db, logger, browserHost, live, ipcMain, dialog } = deps

  ipcMain.handle(IPC_CHANNELS.settingsGet, async () => readSettings(db))
  ipcMain.handle(IPC_CHANNELS.settingsSet, async (_e, partial: unknown) => {
    const cur = await readSettings(db)
    const next = SettingsSchema.parse({ ...cur, ...(partial as object) })
    await writeSettings(db, next)
    return next
  })

  ipcMain.handle(IPC_CHANNELS.strategiesList, async () => {
    const rows = await db.select().from(schema.strategies)
    const out: { id: string; name: string; updatedAt: number }[] = []
    for (const r of rows) {
      const v = await db
        .select()
        .from(schema.strategyVersions)
        .where(eq(schema.strategyVersions.strategyId, r.id))
        .orderBy(desc(schema.strategyVersions.version))
        .limit(1)
      out.push({
        id: r.id,
        name: r.name,
        updatedAt: v[0]?.createdAt.getTime() ?? r.updatedAt.getTime()
      })
    }
    return out
  })

  ipcMain.handle(IPC_CHANNELS.strategyGet, async (_e, id: string) => {
    const v = await db
      .select()
      .from(schema.strategyVersions)
      .where(eq(schema.strategyVersions.strategyId, id))
      .orderBy(desc(schema.strategyVersions.version))
      .limit(1)
    if (!v.length) return null
    return JSON.parse(v[0]!.configJson) as unknown
  })

  ipcMain.handle(IPC_CHANNELS.strategySave, async (_e, payload: unknown) => {
    const cfg = StrategyConfigSchema.parse(payload)
    const now = new Date()
    const existing = await db.select().from(schema.strategies).where(eq(schema.strategies.id, cfg.id))
    if (!existing.length) {
      await db.insert(schema.strategies).values({
        id: cfg.id,
        name: cfg.name,
        createdAt: now,
        updatedAt: now
      })
    } else {
      await db
        .update(schema.strategies)
        .set({ name: cfg.name, updatedAt: now })
        .where(eq(schema.strategies.id, cfg.id))
    }
    const vers = await db
      .select()
      .from(schema.strategyVersions)
      .where(eq(schema.strategyVersions.strategyId, cfg.id))
      .orderBy(desc(schema.strategyVersions.version))
      .limit(1)
    const nextV = (vers[0]?.version ?? 0) + 1
    await db.insert(schema.strategyVersions).values({
      id: randomUUID(),
      strategyId: cfg.id,
      version: nextV,
      configJson: JSON.stringify(cfg),
      createdAt: now
    })
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.strategyDelete, async (_e, id: string) => {
    await db.delete(schema.strategies).where(eq(schema.strategies.id, id))
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.strategyValidate, async (_e, payload: unknown) => {
    const r = StrategyConfigSchema.safeParse(payload)
    if (r.success) return { ok: true as const, data: r.data }
    return { ok: false as const, errors: r.error.flatten() }
  })

  ipcMain.handle(IPC_CHANNELS.simulationRun, async (_e, req: unknown) => {
    const { runMonteCarlo } = await import('@modules/simulator/batch')
    const parsed = SimulationRunRequestSchema.parse(req)
    const { metrics, summaries, lastCurve } = runMonteCarlo({
      strategy: parsed.strategyConfig,
      seed: parsed.seed,
      spinCount: parsed.spinCount,
      initialBankroll: parsed.initialBankroll,
      batchSessions: parsed.batchSessions
    })
    const simId = randomUUID()
    const now = new Date()
    await db.insert(schema.sessions).values({
      id: simId,
      mode: 'simulation',
      state: 'completed',
      strategyVersionId: null,
      initialBankroll: parsed.initialBankroll,
      startedAt: now,
      endedAt: now,
      metadataJson: JSON.stringify({ metrics, summaries, lastCurve, seed: parsed.seed }),
      createdAt: now,
      updatedAt: now
    })
    return { simulationId: simId, metrics, summaries, lastCurve }
  })

  ipcMain.handle(IPC_CHANNELS.simulationRunHistorical, async (_e, req: unknown) => {
    const { runHistoricalSession } = await import('@modules/simulator/batch')
    const parsed = SimulationHistoricalRequestSchema.parse(req)
    const { summary, bankrollCurve } = runHistoricalSession(
      parsed.strategyConfig,
      parsed.spins,
      parsed.initialBankroll
    )
    const simId = randomUUID()
    const now = new Date()
    await db.insert(schema.sessions).values({
      id: simId,
      mode: 'simulation',
      state: 'completed',
      strategyVersionId: null,
      initialBankroll: parsed.initialBankroll,
      startedAt: now,
      endedAt: now,
      metadataJson: JSON.stringify({
        metrics: {
          totalSessions: 1,
          winRate: summary.endingBankroll > parsed.initialBankroll ? 1 : 0,
          evEstimate: (summary.endingBankroll - parsed.initialBankroll) / parsed.initialBankroll,
          maxDrawdownAcrossSessions: summary.maxDrawdown,
          longestLossStreak: summary.longestLossStreak,
          longestWinStreak: summary.longestWinStreak,
          endingBankrollDistribution: [summary.endingBankroll]
        },
        summaries: [summary],
        lastCurve: bankrollCurve,
        historical: true
      }),
      createdAt: now,
      updatedAt: now
    })
    return { simulationId: simId, summary, bankrollCurve }
  })

  ipcMain.handle(IPC_CHANNELS.simulationGet, async (_e, id: string) => {
    const row = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).limit(1)
    if (!row.length) return null
    return JSON.parse(row[0]!.metadataJson ?? '{}') as unknown
  })

  ipcMain.handle(IPC_CHANNELS.importSpinsCsv, async (_e, filePath: string) => {
    const text = readFileSync(filePath, 'utf8')
    const spins = parseSpinCsv(text)
    const jobId = randomUUID()
    const now = new Date()
    await db.insert(schema.importJobs).values({
      id: jobId,
      kind: 'spins_csv',
      status: 'completed',
      payloadJson: JSON.stringify({ count: spins.length }),
      createdAt: now,
      finishedAt: now
    })
    return { jobId, spins }
  })

  ipcMain.handle(IPC_CHANNELS.exportResultsCsv, async (_e, rows: { bankroll: number }[]) => {
    const header = 'step,bankroll\n'
    const body = rows.map((r, i) => `${i},${r.bankroll}`).join('\n')
    return header + body
  })

  ipcMain.handle(IPC_CHANNELS.browserLaunch, async (_e, url?: string) => {
    await browserHost.launch(url)
    return { ok: true as const }
  })
  ipcMain.handle(IPC_CHANNELS.browserClose, async () => {
    await browserHost.close()
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.sessionStart, async (_e, req: unknown) => {
    const parsed = SessionStartRequestSchema.parse(req)
    const settings = await readSettings(db)
    let strategy = parsed.strategyConfig
    if (!strategy && parsed.strategyId) {
      const v = await db
        .select()
        .from(schema.strategyVersions)
        .where(eq(schema.strategyVersions.strategyId, parsed.strategyId))
        .orderBy(desc(schema.strategyVersions.version))
        .limit(1)
      if (!v.length) throw new Error('Strategy not found')
      strategy = StrategyConfigSchema.parse(JSON.parse(v[0]!.configJson))
    }
    if (!strategy) throw new Error('strategyConfig or strategyId required')

    if (parsed.startUrl) {
      await browserHost.launch(parsed.startUrl)
    }
    const page = browserHost.getPage()
    const observer =
      page && parsed.startUrl
        ? isGalaxsysRouletteXUrl(parsed.startUrl)
          ? new GalaxsysRouletteXObserver(page)
          : new GenericDomObserver(page, {})
        : new MockTableObserver(() => {
            const n = EURO_WHEEL_SEQ[mockWheelCursor % EURO_WHEEL_SEQ.length]!
            mockWheelCursor += 1
            return {
              recentNumbers: [n],
              bettingOpen: false,
              timerSeconds: null,
              balance: parsed.initialBankroll,
              tableLabel: 'mock',
              rawNote: 'synthetic-wheel'
            }
          })
    const executor = page && parsed.startUrl && isGalaxsysRouletteXUrl(parsed.startUrl)
      ? new GalaxsysRouletteXExecutor(page)
      : new MockTableExecutor()
    const { sessionId } = await live.start({
      mode: parsed.mode,
      strategy,
      settings,
      initialBankroll: parsed.initialBankroll,
      observer,
      executor
    })
    logger.log('info', 'Session started', { sessionId, mode: parsed.mode })
    return { sessionId }
  })

  ipcMain.handle(IPC_CHANNELS.sessionStop, async () => {
    await live.stop()
    return { ok: true as const }
  })
  ipcMain.handle(IPC_CHANNELS.sessionPause, async () => {
    live.pause()
    return { ok: true as const }
  })
  ipcMain.handle(IPC_CHANNELS.sessionResume, async () => {
    live.resume()
    return { ok: true as const }
  })
  ipcMain.handle(IPC_CHANNELS.sessionTimeline, async () => live.getTimeline())
  ipcMain.handle(IPC_CHANNELS.sessionStatus, async () => ({
    sessionId: live.getSessionId(),
    pending: live.getPendingDecision()
  }))

  ipcMain.handle(IPC_CHANNELS.sessionConfirm, async (_e, payload: unknown) => {
    const p = SessionConfirmPayloadSchema.parse(payload)
    const settings = await readSettings(db)
    const page = browserHost.getPage()
    const currentUrl = page?.url()
    const executor = page && isGalaxsysRouletteXUrl(currentUrl) ? new GalaxsysRouletteXExecutor(page) : new MockTableExecutor()
    await live.confirmPending(p.accept, executor, settings)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.dialogPickFile, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return res.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.analyticsOverview, async () => {
    const rows = await db
      .select()
      .from(schema.spins)
      .orderBy(desc(schema.spins.observedAt))
      .limit(500)
    const chronological = [...rows].reverse()
    const spins = chronological.map((r) => r.value)
    const summary = summarizeSpinAnalytics(spins)
    const recentSpinsDesc = rows.slice(0, 36).map((r) => r.value)
    return { summary, recentSpinsDesc, spinTotal: spins.length }
  })

  ipcMain.handle(IPC_CHANNELS.logsQuery, async (_e, filter: { level?: string; limit?: number }) => {
    const limit = filter?.limit ?? 200
    const rows = await db
      .select()
      .from(schema.errorEvents)
      .orderBy(desc(schema.errorEvents.createdAt))
      .limit(limit)
    return rows.map((r) => ({
      id: r.id,
      level: r.level,
      message: r.message,
      at: r.createdAt.getTime()
    }))
  })
}
