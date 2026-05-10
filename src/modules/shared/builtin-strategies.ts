/**
 * Built-in strategy preset — VIP-five only (only strategy surfaced in the UI).
 */
export const PRIMARY_VIP_STRATEGY_ID = 'builtin-vip-five' as const

export const BUILTIN_STRATEGY_ENTRIES = [
  {
    id: PRIMARY_VIP_STRATEGY_ID,
    name: 'VIP-five',
    config: {
      id: PRIMARY_VIP_STRATEGY_ID,
      name: 'VIP-five',
      tableName: 'European',
      baseUnit: 1,
      progression: { type: 'vip_five' as const, numbers: [4, 8, 18, 19, 20] },
      resetOnWin: false,
      allowedBetTypes: ['straight' as const],
      primaryTarget: { kind: 'straight' as const, number: 4 },
      customTables: [],
      trigger: { kind: 'always' as const },
      stopRules: {}
    }
  }
] as const

export function getBuiltinStrategyConfigById(id: string): unknown | null {
  for (const b of BUILTIN_STRATEGY_ENTRIES) {
    if (b.id === id) return b.config
  }
  return null
}
