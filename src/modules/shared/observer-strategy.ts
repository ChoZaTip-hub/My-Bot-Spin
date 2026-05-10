import type { StrategyConfig } from './strategy-config'

/**
 * Placeholder strategy for observer-only sessions (engine is not run; only spins are recorded).
 */
export const OBSERVER_STRATEGY: StrategyConfig = {
  id: '_observer',
  name: 'Observer',
  tableName: 'european',
  baseUnit: 1,
  progression: { type: 'flat', multiplier: 1 },
  resetOnWin: true,
  allowedBetTypes: ['straight'],
  primaryTarget: { kind: 'straight', number: 0 },
  customTables: [],
  trigger: { kind: 'always' },
  stopRules: {}
}
