import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { eq } from 'drizzle-orm'
import * as schema from '@modules/db/schema'
import type { DbClient } from '@modules/db/client'
import type { Decision } from '@modules/shared/decision'
import { decisionHalt } from '@modules/shared/decision'
import type { AppMode } from '@modules/shared/modes'
import type { StrategyConfig } from '@modules/shared/strategy-config'
import { TableConfigSchema } from '@modules/shared/strategy-config'
import type { AppSettings } from '@modules/shared/ipc-contract'
import { composePolicyDecision, composePolicyFromRawDecision } from '@modules/policy/composer'
import { buildVipFiveDecision } from '@modules/vip-five/vip-decision'
import {
  chipsPerNumberForNextBet,
  computeVipSessionBalance,
  roundOutcomeHit,
  vipSessionSuccess
} from '@modules/vip-five/vip-progress'
import type { TableObservation, TableObserver } from '@modules/parser/types'
import type { RiskLimits } from '@modules/risk-manager/types'
import type { TableExecutor } from '@modules/executor/types'
import type { Logger } from '../logger'
import type { BrowserHost } from '../playwright/BrowserHost'

export type TimelineEntry = {
  id: string
  at: number
  kind: 'spin' | 'decision' | 'risk' | 'note'
  payload: Record<string, unknown>
}

function isVipFiveStrategy(s: StrategyConfig): boolean {
  return s.progression.type === 'vip_five'
}

export class LiveSessionController {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly timeline: TimelineEntry[] = []
  private sessionId: string | null = null
  private paused = false
  private progressionStep = 0
  private consecutiveLosses = 0
  private lastBetOutcome: 'win' | 'loss' | 'none' = 'none'
  private spinHistory: number[] = []
  private bankroll = 0
  private pendingDecision: Decision | null = null
  /** VIP-five session state */
  private vipRoundWins: boolean[] = []
  private vipAwaitingOutcome = false
  /** Last observed spin value when the current open bet was placed (wait until wheel shows a new number). */
  private vipSpinAnchor: number | null = null
  /** The exact five numbers used for currently open VIP bet. */
  private vipOpenBetNumbers: number[] = []
  /** Throttle "no numbers from page" notes for VIP tick (observer empty). */
  private vipLastEmptyNoteAt = 0
  /** Round / ticket id when the open VIP bet was placed (detect new spin even if winning number repeats). */
  private vipRoundIdAtBetOpen: string | null = null
  /** First observed table balance in this session — baseline for take-profit / max-loss. */
  private sessionRiskBaseline: number | null = null

  constructor(
    private readonly db: DbClient['db'],
    private readonly logger: Logger,
    private readonly browserHost: BrowserHost,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  getTimeline(): TimelineEntry[] {
    return [...this.timeline]
  }

  private computeSessionPnL(obs: TableObservation): { sessionProfit: number; sessionLoss: number } {
    if (obs.balance == null) return { sessionProfit: 0, sessionLoss: 0 }
    if (this.sessionRiskBaseline === null) {
      this.sessionRiskBaseline = obs.balance
    }
    const delta = obs.balance - this.sessionRiskBaseline
    return {
      sessionProfit: Math.max(0, delta),
      sessionLoss: Math.max(0, -delta)
    }
  }

  /**
   * If the policy decision does not require an extra UI confirm step, run the executor here.
   * (When `perSessionExecutionConsent` is already true, {@link Decision.requiresConfirmation} is false.)
   */
  private async maybeAutoExecutePlaceBet(
    d: Decision,
    params: {
      mode: AppMode
      settings: AppSettings
      executor: TableExecutor
    }
  ): Promise<void> {
    if (d.action !== 'PLACE_BET' || !d.stakePlan?.length) return

    if (params.settings.dryRunOnly || params.mode !== 'confirmed-action') {
      this.push({ kind: 'note', payload: { text: 'Execution skipped by policy/settings' } })
      return
    }

    if (d.requiresConfirmation) {
      return
    }

    if (!params.settings.executorEnabled) {
      this.push({
        kind: 'note',
        payload: { text: 'Execution skipped: executor disabled in settings' }
      })
      return
    }

    try {
      const r = await params.executor.placeBet(d.stakePlan)
      this.push({
        kind: 'note',
        payload: {
          text: 'Executor placeBet',
          executorId: params.executor.id,
          result: r
        }
      })
      if (params.executor.id === 'mock' && r.ok) {
        this.push({
          kind: 'note',
          payload: {
            text:
              'Mock executor — no real clicks on the table. Set start URL to https://fresh.casino/table/galaxsys-roulettex or …/galaxys-roulettex so the Galaxsys adapter loads.'
          }
        })
      }
      this.pendingDecision = null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.log('error', 'Auto placeBet failed', { error: msg })
      this.push({ kind: 'note', payload: { text: 'Executor placeBet failed', error: msg } })
    }
  }

  private push(entry: Omit<TimelineEntry, 'id' | 'at'> & { id?: string; at?: number }) {
    const full: TimelineEntry = {
      id: entry.id ?? randomUUID(),
      at: entry.at ?? Date.now(),
      kind: entry.kind,
      payload: entry.payload
    }
    this.timeline.push(full)
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('session:timeline-event', full)
    }
  }

  async start(params: {
    mode: AppMode
    strategy: StrategyConfig
    settings: AppSettings
    initialBankroll: number
    observer: TableObserver
    executor: TableExecutor
    riskLimits: RiskLimits
  }): Promise<{ sessionId: string }> {
    await this.stop()
    const now = Date.now()
    const sessionId = randomUUID()
    this.sessionId = sessionId
    this.paused = false
    this.progressionStep = 0
    this.consecutiveLosses = 0
    this.lastBetOutcome = 'none'
    this.spinHistory = []
    this.bankroll = params.initialBankroll
    this.timeline.length = 0
    this.vipRoundWins = []
    this.vipAwaitingOutcome = false
    this.vipSpinAnchor = null
    this.vipOpenBetNumbers = []
    this.vipLastEmptyNoteAt = 0
    this.vipRoundIdAtBetOpen = null
    this.sessionRiskBaseline = null

    await this.db.insert(schema.sessions).values({
      id: sessionId,
      mode: params.mode,
      state: 'running',
      strategyVersionId: null,
      initialBankroll: params.initialBankroll,
      startedAt: new Date(now),
      endedAt: null,
      metadataJson: JSON.stringify({ strategyName: params.strategy.name }),
      createdAt: new Date(now),
      updatedAt: new Date(now)
    })

    const table = TableConfigSchema.parse({ wheel: 'european' })
    const riskLimits = params.riskLimits

    this.timer = setInterval(async () => {
      if (!this.sessionId || this.paused) return
      try {
        if (isVipFiveStrategy(params.strategy)) {
          await this.tickVipSession(params, now, riskLimits)
          return
        }

        const obs = await params.observer.observe()
        const { sessionProfit, sessionLoss } = this.computeSessionPnL(obs)
        if (obs.recentNumbers.length) {
          const last = obs.recentNumbers[0]!
          if (this.spinHistory.at(-1) !== last) {
            this.spinHistory.push(last)
            this.push({ kind: 'spin', payload: { value: last, source: 'observer' } })
            await this.db.insert(schema.spins).values({
              id: randomUUID(),
              sessionId: this.sessionId,
              value: last,
              source: 'observer',
              observedAt: new Date()
            })
          }
        }

        const engineInput = {
          bankroll: this.bankroll,
          spinHistory: this.spinHistory,
          strategy: params.strategy,
          table,
          progressionStep: this.progressionStep,
          consecutiveLosses: this.consecutiveLosses,
          lastBetOutcome: this.lastBetOutcome
        }

        const policyDecision = composePolicyDecision({
          mode: params.mode,
          settings: {
            dryRunOnly: params.settings.dryRunOnly,
            perSessionExecutionConsent: params.settings.perSessionExecutionConsent,
            executorEnabled: params.settings.executorEnabled
          },
          riskInput: {
            sessionLoss,
            sessionProfit,
            progressionDepth: this.progressionStep,
            sessionStartedAt: now,
            now: Date.now(),
            totalBetsPlaced: 0,
            lastBetAt: null,
            emergencyHalt: false
          },
          riskLimits,
          engineInput
        })

        for (const f of policyDecision.riskFlags) {
          this.push({ kind: 'risk', payload: { flag: f } })
        }

        if (policyDecision.action === 'HALT') {
          this.push({ kind: 'decision', payload: { decision: policyDecision } })
          await this.db.insert(schema.decisions).values({
            id: randomUUID(),
            sessionId: this.sessionId,
            payloadJson: JSON.stringify(policyDecision),
            createdAt: new Date()
          })
          await this.stop()
          return
        }

        this.push({ kind: 'decision', payload: { decision: policyDecision } })
        await this.db.insert(schema.decisions).values({
          id: randomUUID(),
          sessionId: this.sessionId,
          payloadJson: JSON.stringify(policyDecision),
          createdAt: new Date()
        })

        this.pendingDecision = policyDecision

        await this.maybeAutoExecutePlaceBet(policyDecision, params)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.log('error', 'Live session tick failed', { error: msg })
        const shot = await this.browserHost.screenshotOnError(e, this.sessionId ?? undefined)
        const errId = randomUUID()
        await this.db.insert(schema.errorEvents).values({
          id: errId,
          sessionId: this.sessionId,
          level: 'error',
          message: msg,
          stack: e instanceof Error ? e.stack : undefined,
          contextJson: JSON.stringify({ phase: 'tick' }),
          createdAt: new Date()
        })
        if (shot) {
          await this.db.insert(schema.screenshots).values({
            id: randomUUID(),
            errorEventId: errId,
            sessionId: this.sessionId,
            path: shot,
            createdAt: new Date()
          })
        }
      }
    }, 2000)

    return { sessionId }
  }

  private async tickVipSession(
    params: {
      mode: AppMode
      strategy: StrategyConfig
      settings: AppSettings
      observer: TableObserver
      executor: TableExecutor
    },
    sessionStartedAt: number,
    riskLimits: RiskLimits
  ): Promise<void> {
    if (!this.sessionId) return
    const obs = await params.observer.observe()
    const { sessionProfit, sessionLoss } = this.computeSessionPnL(obs)
    if (!obs.recentNumbers.length) {
      const t = Date.now()
      if (t - this.vipLastEmptyNoteAt > 12_000) {
        this.vipLastEmptyNoteAt = t
        this.push({
          kind: 'note',
          payload: {
            text:
              'Стол открыт, но номер последнего спина пока не распознан (часто игра в iframe или другая вёрстка). Откройте боковую «История» на столе и дождитесь спина. Проверьте URL: …/galaxsys-roulettex',
            observerHint: obs.rawNote ?? ''
          }
        })
      }
      return
    }
    const last = obs.recentNumbers[0]!

    if (this.vipAwaitingOutcome) {
      const roundAdvanced =
        this.vipRoundIdAtBetOpen != null &&
        obs.roundId != null &&
        obs.roundId !== this.vipRoundIdAtBetOpen
      /** Without round id, same winning number twice in a row would deadlock — round id fixes that. */
      const numberAdvanced = last !== this.vipSpinAnchor
      if (!roundAdvanced && !numberAdvanced) {
        return
      }
    }

    const prog = params.strategy.progression
    if (prog.type !== 'vip_five') return

    if (this.vipAwaitingOutcome) {
      const numbersForOpenBet = this.vipOpenBetNumbers.length ? this.vipOpenBetNumbers : prog.numbers
      const hit = roundOutcomeHit(last, numbersForOpenBet)
      this.vipRoundWins.push(hit)
      this.spinHistory.push(last)
      this.push({
        kind: 'spin',
        payload: {
          value: last,
          source: 'observer',
          vipRound: this.vipRoundWins.length,
          hit,
          vipBalance: computeVipSessionBalance(this.vipRoundWins)
        }
      })
      await this.db.insert(schema.spins).values({
        id: randomUUID(),
        sessionId: this.sessionId,
        value: last,
        source: 'observer',
        observedAt: new Date()
      })

      if (vipSessionSuccess(this.vipRoundWins)) {
        const haltDec = decisionHalt(
          'VIP session finished: chip balance ≥800 or ≥1000 winning rounds',
          ['vip_session_success']
        )
        this.push({ kind: 'decision', payload: { decision: haltDec } })
        await this.db.insert(schema.decisions).values({
          id: randomUUID(),
          sessionId: this.sessionId,
          payloadJson: JSON.stringify(haltDec),
          createdAt: new Date()
        })
        this.pendingDecision = haltDec
        await this.stop()
        return
      }

      this.vipAwaitingOutcome = false
    }

    if (!this.sessionId) return

    const raw = buildVipFiveDecision(params.strategy, this.vipRoundWins, last)
    const policyDecision = composePolicyFromRawDecision(raw, {
      mode: params.mode,
      settings: {
        dryRunOnly: params.settings.dryRunOnly,
        perSessionExecutionConsent: params.settings.perSessionExecutionConsent,
        executorEnabled: params.settings.executorEnabled
      },
      riskInput: {
        sessionLoss,
        sessionProfit,
        progressionDepth: this.vipRoundWins.length,
        sessionStartedAt,
        now: Date.now(),
        totalBetsPlaced: this.vipRoundWins.length,
        lastBetAt: null,
        emergencyHalt: false
      },
      riskLimits
    })

    for (const f of policyDecision.riskFlags) {
      this.push({ kind: 'risk', payload: { flag: f } })
    }

    if (policyDecision.action === 'HALT') {
      this.push({ kind: 'decision', payload: { decision: policyDecision } })
      await this.db.insert(schema.decisions).values({
        id: randomUUID(),
        sessionId: this.sessionId,
        payloadJson: JSON.stringify(policyDecision),
        createdAt: new Date()
      })
      await this.stop()
      return
    }

    this.push({ kind: 'decision', payload: { decision: policyDecision } })
    await this.db.insert(schema.decisions).values({
      id: randomUUID(),
      sessionId: this.sessionId,
      payloadJson: JSON.stringify(policyDecision),
      createdAt: new Date()
    })

    this.pendingDecision = policyDecision

    await this.maybeAutoExecutePlaceBet(policyDecision, params)

    this.push({
      kind: 'note',
      payload: {
        text: 'VIP-five: open bet for next spin',
        vipBalance: computeVipSessionBalance(this.vipRoundWins),
        chipsPerNumber: chipsPerNumberForNextBet(this.vipRoundWins),
        numbers: raw.metadata.numbers,
        feedOutcome: raw.metadata.feedSourceOutcome,
        feedNumbers: raw.metadata.numbers
      }
    })

    this.vipOpenBetNumbers = Array.isArray(raw.metadata.numbers)
      ? raw.metadata.numbers.filter((n): n is number => typeof n === 'number')
      : []
    this.vipAwaitingOutcome = true
    this.vipSpinAnchor = last
    this.vipRoundIdAtBetOpen = obs.roundId ?? null
  }

  pause(): void {
    this.paused = true
    if (this.sessionId) {
      void this.db
        .update(schema.sessions)
        .set({ state: 'paused', updatedAt: new Date() })
        .where(eq(schema.sessions.id, this.sessionId))
    }
  }

  resume(): void {
    this.paused = false
    if (this.sessionId) {
      void this.db
        .update(schema.sessions)
        .set({ state: 'running', updatedAt: new Date() })
        .where(eq(schema.sessions.id, this.sessionId))
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.sessionId) {
      await this.db
        .update(schema.sessions)
        .set({ state: 'completed', endedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.sessions.id, this.sessionId))
    }
    this.sessionId = null
    this.pendingDecision = null
    this.vipRoundWins = []
    this.vipAwaitingOutcome = false
    this.vipSpinAnchor = null
    this.vipOpenBetNumbers = []
    this.vipRoundIdAtBetOpen = null
    this.sessionRiskBaseline = null
  }

  getPendingDecision(): Decision | null {
    return this.pendingDecision
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  async confirmPending(
    accept: boolean,
    executor: TableExecutor,
    settings: AppSettings
  ): Promise<void> {
    const d = this.pendingDecision
    if (!d || !accept) {
      this.pendingDecision = null
      return
    }
    if (settings.dryRunOnly || !settings.executorEnabled) {
      this.push({ kind: 'note', payload: { text: 'Confirmation ignored: execution disabled' } })
      this.pendingDecision = null
      return
    }
    if (d.action === 'PLACE_BET' && d.stakePlan?.length) {
      const r = await executor.placeBet(d.stakePlan)
      this.push({ kind: 'note', payload: { text: 'Executor placeBet', result: r } })
    }
    this.pendingDecision = null
  }
}
