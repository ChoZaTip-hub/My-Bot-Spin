import type { StrategyConfig } from '@modules/shared/strategy-config'
import { drawEuropeanSpin, mulberry32 } from './rng'
import { aggregateSummaries, type BatchMetrics, type SessionSummary } from './metrics'
import { runVirtualSession, stateToSummary } from './session'

export type MonteCarloRequest = {
  strategy: StrategyConfig
  seed: number
  spinCount: number
  initialBankroll: number
  batchSessions: number
}

export function runMonteCarlo(req: MonteCarloRequest): {
  metrics: BatchMetrics
  summaries: SessionSummary[]
  lastCurve: number[]
} {
  const summaries: SessionSummary[] = []
  let lastCurve: number[] = []
  for (let b = 0; b < req.batchSessions; b += 1) {
    const rng = mulberry32(req.seed + b * 1_000_003)
    const nextSpin = () => drawEuropeanSpin(rng)
    const { state, bankrollCurve } = runVirtualSession(
      req.strategy,
      req.spinCount,
      req.initialBankroll,
      nextSpin
    )
    summaries.push(stateToSummary(state))
    lastCurve = bankrollCurve
  }
  const metrics = aggregateSummaries(summaries, req.initialBankroll)
  return { metrics, summaries, lastCurve }
}

export function runHistoricalSession(
  strategy: StrategyConfig,
  spins: number[],
  initialBankroll: number
): { summary: SessionSummary; bankrollCurve: number[] } {
  let idx = 0
  const nextSpin = () => {
    const v = spins[idx] ?? 0
    idx += 1
    return v
  }
  const { state, bankrollCurve } = runVirtualSession(
    strategy,
    spins.length,
    initialBankroll,
    nextSpin
  )
  return { summary: stateToSummary(state), bankrollCurve }
}
