import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { DbClient } from '@modules/db/client'
import * as schema from '@modules/db/schema'
import { StrategyConfigSchema } from '@modules/shared/strategy-config'
import type { Logger } from './logger'

const BUILT_INS = [
  {
    id: 'builtin-flat-red',
    name: 'Flat red/black (red)',
    config: {
      id: 'builtin-flat-red',
      name: 'Flat red/black (red)',
      tableName: 'European',
      baseUnit: 1,
      progression: { type: 'flat' as const, multiplier: 1 },
      resetOnWin: true,
      allowedBetTypes: ['red' as const],
      primaryTarget: { kind: 'red' as const },
      customTables: [],
      trigger: { kind: 'always' as const },
      stopRules: {}
    }
  },
  {
    id: 'builtin-custom-table',
    name: 'Custom number table progression',
    config: {
      id: 'builtin-custom-table',
      name: 'Custom number table progression',
      tableName: 'European',
      baseUnit: 1,
      progression: { type: 'sequence' as const, multipliers: [1, 2, 4] },
      resetOnWin: true,
      allowedBetTypes: ['custom_table' as const],
      primaryTarget: { kind: 'custom_table' as const, tableName: 'voisins' },
      customTables: [
        { name: 'voisins', numbers: [22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25] }
      ],
      trigger: { kind: 'after_spin_count' as const, minHistory: 1 },
      stopRules: { maxProgressionDepth: 6 }
    }
  },
  {
    id: 'builtin-dozen-col',
    name: 'Dozen / column progression',
    config: {
      id: 'builtin-dozen-col',
      name: 'Dozen / column progression',
      tableName: 'European',
      baseUnit: 1,
      progression: { type: 'sequence' as const, multipliers: [1, 2, 3] },
      resetOnWin: false,
      allowedBetTypes: ['dozen' as const, 'column' as const],
      primaryTarget: { kind: 'dozen' as const, dozen: 2 as const },
      customTables: [],
      trigger: { kind: 'always' as const },
      stopRules: {}
    }
  },
  {
    id: 'builtin-vip-five',
    name: 'VIP five numbers (session rules)',
    config: {
      id: 'builtin-vip-five',
      name: 'VIP five numbers (session rules)',
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
]

export async function seedIfEmpty(db: DbClient['db'], logger: Logger): Promise<void> {
  logger.log('info', 'Ensuring built-in strategies')
  const now = new Date()
  for (const b of BUILT_INS) {
    const cfg = StrategyConfigSchema.parse(b.config)
    const existing = await db.select().from(schema.strategies).where(eq(schema.strategies.id, cfg.id)).limit(1)
    if (!existing.length) {
      logger.log('info', 'Seeding missing built-in strategy', { strategyId: cfg.id })
      await db.insert(schema.strategies).values({
        id: cfg.id,
        name: cfg.name,
        createdAt: now,
        updatedAt: now
      })
    }
    const versions = await db
      .select()
      .from(schema.strategyVersions)
      .where(eq(schema.strategyVersions.strategyId, cfg.id))
      .limit(1)
    if (!versions.length) {
      await db.insert(schema.strategyVersions).values({
        id: randomUUID(),
        strategyId: cfg.id,
        version: 1,
        configJson: JSON.stringify(cfg),
        createdAt: now
      })
    }
  }
}
