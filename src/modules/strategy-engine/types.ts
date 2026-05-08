import type { StrategyConfig, TableConfig } from '@modules/shared/strategy-config'

export type BetOutcome = 'win' | 'loss' | 'none'

export type EngineInput = {
  bankroll: number
  spinHistory: number[]
  strategy: StrategyConfig
  table: TableConfig
  progressionStep: number
  consecutiveLosses: number
  lastBetOutcome: BetOutcome
}
