import { describe, expect, it } from 'vitest'
import { runMonteCarlo } from '@modules/simulator/batch'
import { StrategyConfigSchema } from '@modules/shared/strategy-config'

const strategy = StrategyConfigSchema.parse({
  id: 'sim',
  name: 'sim',
  tableName: 'European',
  baseUnit: 1,
  progression: { type: 'flat', multiplier: 1 },
  resetOnWin: true,
  allowedBetTypes: ['red'],
  primaryTarget: { kind: 'red' },
  customTables: [],
  trigger: { kind: 'always' },
  stopRules: {}
})

describe('simulator', () => {
  it('is deterministic for fixed seed', () => {
    const a = runMonteCarlo({
      strategy,
      seed: 999,
      spinCount: 200,
      initialBankroll: 1000,
      batchSessions: 3
    })
    const b = runMonteCarlo({
      strategy,
      seed: 999,
      spinCount: 200,
      initialBankroll: 1000,
      batchSessions: 3
    })
    expect(a.metrics.evEstimate).toBe(b.metrics.evEstimate)
    expect(a.lastCurve.at(-1)).toBe(b.lastCurve.at(-1))
  })
})
