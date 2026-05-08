import { describe, expect, it } from 'vitest'
import { SettingsSchema, SimulationRunRequestSchema } from '@modules/shared/ipc-contract'
import { StrategyConfigSchema } from '@modules/shared/strategy-config'

describe('zod schemas', () => {
  it('parses settings defaults', () => {
    const s = SettingsSchema.parse({})
    expect(s.locale).toBe('en')
    expect(s.dryRunOnly).toBe(true)
    expect(s.executorEnabled).toBe(false)
  })

  it('parses simulation request', () => {
    const cfg = StrategyConfigSchema.parse({
      id: 'x',
      name: 'x',
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
    const r = SimulationRunRequestSchema.parse({
      strategyConfig: cfg,
      seed: 1,
      spinCount: 10,
      initialBankroll: 100,
      batchSessions: 2
    })
    expect(r.batchSessions).toBe(2)
  })
})
