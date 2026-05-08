import { describe, expect, it } from 'vitest'
import { decideNextAction } from '@modules/strategy-engine/engine'
import { TableConfigSchema, StrategyConfigSchema } from '@modules/shared/strategy-config'

const table = TableConfigSchema.parse({ wheel: 'european' })

describe('strategy-engine', () => {
  it('bets red when trigger always', () => {
    const strategy = StrategyConfigSchema.parse({
      id: 't1',
      name: 't',
      tableName: 'European',
      baseUnit: 2,
      progression: { type: 'flat', multiplier: 1 },
      resetOnWin: true,
      allowedBetTypes: ['red'],
      primaryTarget: { kind: 'red' },
      customTables: [],
      trigger: { kind: 'always' },
      stopRules: {}
    })
    const d = decideNextAction({
      bankroll: 100,
      spinHistory: [],
      strategy,
      table,
      progressionStep: 0,
      consecutiveLosses: 0,
      lastBetOutcome: 'none'
    })
    expect(d.action).toBe('PLACE_BET')
    expect(d.stakePlan?.[0]?.betType).toBe('red')
    expect(d.stakePlan?.[0]?.amount).toBe(2)
  })

  it('halts when bankroll insufficient', () => {
    const strategy = StrategyConfigSchema.parse({
      id: 't2',
      name: 't',
      tableName: 'European',
      baseUnit: 50,
      progression: { type: 'flat', multiplier: 1 },
      resetOnWin: true,
      allowedBetTypes: ['red'],
      primaryTarget: { kind: 'red' },
      customTables: [],
      trigger: { kind: 'always' },
      stopRules: {}
    })
    const d = decideNextAction({
      bankroll: 10,
      spinHistory: [],
      strategy,
      table,
      progressionStep: 0,
      consecutiveLosses: 0,
      lastBetOutcome: 'none'
    })
    expect(d.action).toBe('HALT')
  })
})
