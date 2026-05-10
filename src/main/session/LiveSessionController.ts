import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { eq } from 'drizzle-orm'
import * as schema from '@modules/db/schema'
import type { DbClient } from '@modules/db/client'
import type { Decision } from '@modules/shared/decision'
import { decisionHalt } from '@modules/shared/decision'
import type { AppMode } from '@modules/shared/modes'
import type { AssistSnapshot } from '@modules/shared/assist-snapshot'
import type { StrategyConfig } from '@modules/shared/strategy-config'
import { TableConfigSchema } from '@modules/shared/strategy-config'
import type { AppSettings } from '@modules/shared/ipc-contract'
import { composePolicyDecision, composePolicyFromRawDecision } from '@modules/policy/composer'
import { buildVipFiveDecision } from '@modules/vip-five/vip-decision'
import { numbersByLastOutcome } from '@modules/vip-five/vip-feed'
import {
  chipsPerNumberForNextBet,
  computeVipSessionBalance,
  deriveVipProgress,
  roundOutcomeHit,
  vipSessionSuccess
} from '@modules/vip-five/vip-progress'
import { loadVipFeedRowResolver } from '../vip-feed-loader'
import type { TableObservation, TableObserver } from '@modules/parser/types'
import type { RiskLimits } from '@modules/risk-manager/types'
import type { TableExecutor } from '@modules/executor/types'
import { summarizeSpinAnalytics } from '@modules/shared/sector-analytics'
import type { Logger } from '../logger'
import type { BrowserHost } from '../playwright/BrowserHost'

export type TimelineEntry = {
  id: string
  at: number
  kind: 'spin' | 'decision' | 'risk' | 'note' | 'learn'
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
  /** One-shot outcome (0–36) from session start when the observer has no spins yet. Consumed on first use. */
  private pendingManualSpin: number | null = null
  /** Matches userData/teaching/mappings/<key>.json for this session (executor + confirm). */
  private sessionTeachingMappingKey: string | null = null
  /** Assist window — VIP-five strategy copy for snapshots */
  private vipStrategyConfig: StrategyConfig | null = null
  private vipAssistUi: {
    numbers: number[]
    chipsPerNumber: number
    feedOutcome: number | null
  } | null = null
  private assistLastTableBalance: number | null = null
  /** Throttle {@link maybePushObserverLearnSummary} (observer mode). */
  private observerLearnLastPushAt = 0
  /** VIP-five: resolves last outcome → five numbers (DB tables + selection rules). */
  private vipRowResolver: ((outcome: number) => readonly number[]) | null = null
  /** Throttle advisory «consider stopping» notes for VIP stopHints. */
  private vipStopHintCooldownUntil = 0

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

  /** Record new outcomes from the table observer into history, timeline, and DB (shared by live tick and observer-only mode). */
  private async ingestNewSpinsFromObservation(obs: TableObservation): Promise<boolean> {
    let added = false
    if (!obs.recentNumbers.length && this.pendingManualSpin !== null) {
      const seed = this.pendingManualSpin
      this.pendingManualSpin = null
      this.push({
        kind: 'note',
        payload: {
          text:
            'Использован вручную введённый последний номер — дальше нужны спины со стола (или снова старт с новым номером).',
          manualSeed: seed
        }
      })
      if (this.spinHistory.at(-1) !== seed) {
        this.spinHistory.push(seed)
        this.push({ kind: 'spin', payload: { value: seed, source: 'manual_seed' } })
        added = true
        const sidSpin = this.sessionId
        if (!sidSpin) return added
        await this.db.insert(schema.spins).values({
          id: randomUUID(),
          sessionId: sidSpin,
          value: seed,
          source: 'manual_seed',
          observedAt: new Date()
        })
      }
    } else if (obs.recentNumbers.length) {
      const last = obs.recentNumbers[0]!
      if (this.spinHistory.at(-1) !== last) {
        this.spinHistory.push(last)
        this.push({ kind: 'spin', payload: { value: last, source: 'observer' } })
        added = true
        const sidSpin = this.sessionId
        if (!sidSpin) return added
        await this.db.insert(schema.spins).values({
          id: randomUUID(),
          sessionId: sidSpin,
          value: last,
          source: 'observer',
          observedAt: new Date()
        })
      }
    }
    return added
  }

  /**
   * Emit a cumulative analytics snapshot for the current observer session (frequency-only — not predictive).
   * Throttled to avoid flooding the timeline.
   */
  private maybePushObserverLearnSummary(): void {
    const n = this.spinHistory.length
    if (n === 0 || !this.sessionId) return
    const now = Date.now()
    const dt = now - this.observerLearnLastPushAt
    const pushNow = n === 1 || n % 10 === 0 || dt >= 25_000
    if (!pushNow) return
    this.observerLearnLastPushAt = now
    const summary = summarizeSpinAnalytics(this.spinHistory)
    this.push({
      kind: 'learn',
      payload: {
        scope: 'observer_session',
        sessionSpinCount: summary.spinCount,
        dominantSector: summary.dominantSector,
        dominantSectorPct: summary.dominantSectorPct,
        sectorPct: summary.sectorPct,
        zeroPct: summary.zeroPct,
        topNumbers: summary.topNumbers,
        distribution: summary.distribution,
        note:
          'Cumulative frequency for this observer session (descriptive statistics only, not a prediction). Outcomes are persisted in the database for Overview analytics and historical replay.'
      }
    })
    this.logger.log('info', 'Observer learn snapshot', {
      sessionId: this.sessionId,
      spins: summary.spinCount,
      dominantSector: summary.dominantSector
    })
  }

  private async tickObserveOnly(params: { observer: TableObserver }): Promise<void> {
    const obs = await params.observer.observe()
    if (!this.sessionId) return
    const added = await this.ingestNewSpinsFromObservation(obs)
    if (added) {
      this.maybePushObserverLearnSummary()
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
    if (!this.sessionId) return
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
      if (!this.sessionId) return
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
              'Mock executor — no real clicks on the table. Start a session with a valid table URL so the embedded browser opens and the heuristic executor attaches.'
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

  /** Count completed VIP rounds that missed, from the last completed round backward. */
  private static countTrailingVipRoundLosses(roundHits: readonly boolean[]): number {
    let n = 0
    for (let i = roundHits.length - 1; i >= 0; i -= 1) {
      if (roundHits[i]) break
      n += 1
    }
    return n
  }

  /** Advisory timeline notes from `progression.stopHints` (does not halt the session). */
  private maybePushVipStopHints(strategy: StrategyConfig): void {
    if (!this.sessionId || strategy.progression.type !== 'vip_five') return
    const hints = strategy.progression.stopHints
    if (!hints) return

    const now = Date.now()
    if (now < this.vipStopHintCooldownUntil) return

    const parts: string[] = []
    const summary = summarizeSpinAnalytics(this.spinHistory)
    const minSpinsDom = hints.minSpinsForDominantWarn ?? 18

    if (
      typeof hints.warnDominantSectorPctGte === 'number' &&
      summary.spinCount >= minSpinsDom &&
      summary.dominantSector != null &&
      summary.dominantSectorPct >= hints.warnDominantSectorPctGte
    ) {
      const pct = Math.round(summary.dominantSectorPct * 100)
      parts.push(
        `Доля сектора «${summary.dominantSector}» в сессии ${pct}% — по вашим правилам имеет смысл обдумать паузу или смену таблицы.`
      )
    }

    if (typeof hints.warnConsecutiveRoundLossesGte === 'number') {
      const streak = LiveSessionController.countTrailingVipRoundLosses(this.vipRoundWins)
      if (streak >= hints.warnConsecutiveRoundLossesGte) {
        parts.push(
          `Подряд проигранных VIP-раундов: ${streak}. По вашим правилам — сигнал пересмотреть продолжение сессии.`
        )
      }
    }

    if (!parts.length) return

    this.push({
      kind: 'note',
      payload: {
        text: parts.join(' '),
        vipStopHints: true,
        dominantSectorPct: summary.dominantSectorPct,
        consecutiveRoundLossStreak: LiveSessionController.countTrailingVipRoundLosses(this.vipRoundWins)
      }
    })
    this.vipStopHintCooldownUntil = now + 45_000
  }

  async start(params: {
    mode: AppMode
    strategy: StrategyConfig
    settings: AppSettings
    initialBankroll: number
    observer: TableObserver
    executor: TableExecutor
    riskLimits: RiskLimits
    manualLastSpin?: number
    teachingMappingKey?: string
  }): Promise<{ sessionId: string }> {
    await this.stop()
    const now = Date.now()
    const sessionId = randomUUID()

    let preloadedVipRowResolver: ((outcome: number) => readonly number[]) | null = null
    if (isVipFiveStrategy(params.strategy) && params.strategy.progression.type === 'vip_five') {
      preloadedVipRowResolver = await loadVipFeedRowResolver(
        this.db,
        params.strategy,
        () => summarizeSpinAnalytics(this.spinHistory).dominantSector,
        () => this.spinHistory.length
      )
    }

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
    this.pendingManualSpin =
      typeof params.manualLastSpin === 'number' &&
      Number.isInteger(params.manualLastSpin) &&
      params.manualLastSpin >= 0 &&
      params.manualLastSpin <= 36
        ? params.manualLastSpin
        : null

    const tk = params.teachingMappingKey?.trim()
    this.sessionTeachingMappingKey = tk ? tk : null

    this.vipStrategyConfig = null
    this.vipAssistUi = null
    this.assistLastTableBalance = null
    this.observerLearnLastPushAt = 0
    this.vipRowResolver = preloadedVipRowResolver
    this.vipStopHintCooldownUntil = 0

    if (isVipFiveStrategy(params.strategy) && params.strategy.progression.type === 'vip_five') {
      this.vipStrategyConfig = params.strategy
      const p = params.strategy.progression
      this.vipAssistUi = {
        numbers: [...p.numbers],
        chipsPerNumber: chipsPerNumberForNextBet([]),
        feedOutcome: null
      }
    }

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
        if (params.mode === 'observer') {
          await this.tickObserveOnly(params)
          return
        }

        if (isVipFiveStrategy(params.strategy)) {
          await this.tickVipSession(params, now, riskLimits)
          return
        }

        const obs = await params.observer.observe()
        if (!this.sessionId) return
        const { sessionProfit, sessionLoss } = this.computeSessionPnL(obs)
        await this.ingestNewSpinsFromObservation(obs)

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
          const sidHalt = this.sessionId
          if (sidHalt) {
            await this.db.insert(schema.decisions).values({
              id: randomUUID(),
              sessionId: sidHalt,
              payloadJson: JSON.stringify(policyDecision),
              createdAt: new Date()
            })
          }
          await this.stop()
          return
        }

        this.push({ kind: 'decision', payload: { decision: policyDecision } })
        const sidDecision = this.sessionId
        if (!sidDecision) return
        await this.db.insert(schema.decisions).values({
          id: randomUUID(),
          sessionId: sidDecision,
          payloadJson: JSON.stringify(policyDecision),
          createdAt: new Date()
        })

        this.pendingDecision = policyDecision

        if (!this.sessionId) return
        await this.maybeAutoExecutePlaceBet(policyDecision, params)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.log('error', 'Live session tick failed', { error: msg })
        const errSid = this.sessionId
        const shot = await this.browserHost.screenshotOnError(e, errSid ?? undefined)
        if (!errSid) return
        const errId = randomUUID()
        await this.db.insert(schema.errorEvents).values({
          id: errId,
          sessionId: errSid,
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
            sessionId: errSid,
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
    if (!this.sessionId) return
    const { sessionProfit, sessionLoss } = this.computeSessionPnL(obs)
    if (obs.balance != null) {
      this.assistLastTableBalance = obs.balance
    }

    let last: number
    let spinSource: 'observer' | 'manual_seed' = 'observer'

    if (obs.recentNumbers.length) {
      last = obs.recentNumbers[0]!
    } else if (this.pendingManualSpin !== null) {
      last = this.pendingManualSpin
      this.pendingManualSpin = null
      spinSource = 'manual_seed'
      this.push({
        kind: 'note',
        payload: {
          text:
            'Использован вручную заданный последний номер для первого хода. Дальше без распознавания спинов со стола VIP не продвинется — откройте «История» или перезапустите сессию и укажите новый номер.',
          manualSeed: last,
          observerHint: obs.rawNote ?? ''
        }
      })
    } else {
      const t = Date.now()
      if (t - this.vipLastEmptyNoteAt > 12_000) {
        this.vipLastEmptyNoteAt = t
        this.push({
          kind: 'note',
            payload: {
            text:
              'Стол открыт, но номер последнего спина пока не распознан (часто игра в iframe или другая вёрстка). Откройте боковую «История» на столе и дождитесь спина. При старте можно указать последний номер вручную.',
            observerHint: obs.rawNote ?? ''
          }
        })
      }
      return
    }

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
          source: spinSource,
          vipRound: this.vipRoundWins.length,
          hit,
          vipBalance: computeVipSessionBalance(this.vipRoundWins)
        }
      })
      const sidSpin = this.sessionId
      if (!sidSpin) return
      await this.db.insert(schema.spins).values({
        id: randomUUID(),
        sessionId: sidSpin,
        value: last,
        source: spinSource,
        observedAt: new Date()
      })
      if (!this.sessionId) return

      if (vipSessionSuccess(this.vipRoundWins)) {
        const haltDec = decisionHalt(
          'VIP session finished: chip balance ≥800 or ≥1000 winning rounds',
          ['vip_session_success']
        )
        this.push({ kind: 'decision', payload: { decision: haltDec } })
        const sidSucc = this.sessionId
        if (sidSucc) {
          await this.db.insert(schema.decisions).values({
            id: randomUUID(),
            sessionId: sidSucc,
            payloadJson: JSON.stringify(haltDec),
            createdAt: new Date()
          })
        }
        await this.stop()
        return
      }

      this.vipAwaitingOutcome = false
    }

    if (!this.sessionId) return

    this.maybePushVipStopHints(params.strategy)

    const resolveRow =
      this.vipRowResolver ?? ((outcome: number) => [...numbersByLastOutcome(outcome)])
    const raw = buildVipFiveDecision(params.strategy, this.vipRoundWins, last, resolveRow)
    const nums = raw.metadata.numbers
    this.vipAssistUi = {
      numbers: Array.isArray(nums) ? nums.filter((n): n is number => typeof n === 'number') : [],
      chipsPerNumber: typeof raw.metadata.chipsPerNumber === 'number' ? raw.metadata.chipsPerNumber : 1,
      feedOutcome: typeof raw.metadata.feedSourceOutcome === 'number' ? raw.metadata.feedSourceOutcome : null
    }
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
      const sidHalt = this.sessionId
      if (sidHalt) {
        await this.db.insert(schema.decisions).values({
          id: randomUUID(),
          sessionId: sidHalt,
          payloadJson: JSON.stringify(policyDecision),
          createdAt: new Date()
        })
      }
      await this.stop()
      return
    }

    this.push({ kind: 'decision', payload: { decision: policyDecision } })
    const sidDecision = this.sessionId
    if (!sidDecision) return
    await this.db.insert(schema.decisions).values({
      id: randomUUID(),
      sessionId: sidDecision,
      payloadJson: JSON.stringify(policyDecision),
      createdAt: new Date()
    })
    if (!this.sessionId) return

    this.pendingDecision = policyDecision

    await this.maybeAutoExecutePlaceBet(policyDecision, params)
    if (!this.sessionId) return

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

    const endingId = this.sessionId

    /** Drop session identity immediately so long-running ticks (observe / placeBet) abort after await. */
    this.sessionId = null
    this.pendingDecision = null
    this.vipRoundWins = []
    this.vipAwaitingOutcome = false
    this.vipSpinAnchor = null
    this.vipOpenBetNumbers = []
    this.vipRoundIdAtBetOpen = null
    this.sessionRiskBaseline = null
    this.pendingManualSpin = null
    this.sessionTeachingMappingKey = null
    this.vipStrategyConfig = null
    this.vipAssistUi = null
    this.assistLastTableBalance = null

    if (endingId) {
      await this.db
        .update(schema.sessions)
        .set({ state: 'completed', endedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.sessions.id, endingId))
    }

    this.vipRowResolver = null
    this.vipStopHintCooldownUntil = 0
  }

  getAssistSnapshot(): AssistSnapshot {
    if (!this.sessionId || !this.vipStrategyConfig) {
      return { kind: 'idle', reason: 'no_vip_five_session' }
    }
    const cfg = this.vipStrategyConfig
    if (cfg.progression.type !== 'vip_five') {
      return { kind: 'idle', reason: 'no_vip_five_session' }
    }
    const prog = cfg.progression
    const ui = this.vipAssistUi
    const betNumbers =
      ui?.numbers?.length === 5 ? [...ui.numbers] : [...prog.numbers]
    const chips =
      typeof ui?.chipsPerNumber === 'number'
        ? ui.chipsPerNumber
        : chipsPerNumberForNextBet(this.vipRoundWins)
    const baseUnit = cfg.baseUnit
    const stakePerRoundMoney = baseUnit * chips * 5
    const { levelIndex } = deriveVipProgress(this.vipRoundWins)
    const vipChipBalance = computeVipSessionBalance(this.vipRoundWins)
    let tablePnL: number | null = null
    if (this.sessionRiskBaseline != null && this.assistLastTableBalance != null) {
      tablePnL = this.assistLastTableBalance - this.sessionRiskBaseline
    }
    const lastSpin = this.spinHistory.length ? this.spinHistory[this.spinHistory.length - 1]! : null
    const lastHit = this.vipRoundWins.length ? this.vipRoundWins[this.vipRoundWins.length - 1]! : null
    let lastRoundMoneyDelta: number | null = null
    if (this.vipRoundWins.length > 0) {
      const prior = this.vipRoundWins.slice(0, -1)
      const c = chipsPerNumberForNextBet(prior)
      const full = 5 * c * baseUnit
      lastRoundMoneyDelta = lastHit ? baseUnit * c * 36 - full : -full
    }
    return {
      kind: 'vip_five',
      strategyName: cfg.name,
      sessionId: this.sessionId,
      paused: this.paused,
      betNumbers,
      chipsPerNumber: chips,
      baseUnit,
      stakePerRoundMoney,
      levelIndex,
      roundsCompleted: this.vipRoundWins.length,
      vipChipBalance,
      tablePnLMoney: tablePnL,
      lastSpin,
      lastHit,
      lastRoundMoneyDelta,
      feedAnchor: ui?.feedOutcome ?? null,
      awaitingOutcome: this.vipAwaitingOutcome
    }
  }

  getTeachingMappingKey(): string | null {
    return this.sessionTeachingMappingKey
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
