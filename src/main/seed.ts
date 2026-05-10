import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import type { DbClient } from '@modules/db/client'
import * as schema from '@modules/db/schema'
import { BUILTIN_STRATEGY_ENTRIES } from '@modules/shared/builtin-strategies'
import { BUILTIN_VIP_FEED_TABLE_ID } from '@modules/shared/feed-table-mapping'
import { StrategyConfigSchema } from '@modules/shared/strategy-config'
import { VIP_FEED_TABLE } from '@modules/vip-five/vip-feed'
import type { Logger } from './logger'

/** Former shipped presets — removed so only VIP-five remains in the UI/database. */
const LEGACY_BUILTIN_STRATEGY_IDS = ['builtin-flat-red', 'builtin-custom-table', 'builtin-dozen-col'] as const

export async function seedIfEmpty(db: DbClient['db'], logger: Logger): Promise<void> {
  logger.log('info', 'Ensuring built-in strategies')
  const now = new Date()

  const existingFeed = await db
    .select()
    .from(schema.feedTables)
    .where(eq(schema.feedTables.id, BUILTIN_VIP_FEED_TABLE_ID))
    .limit(1)
  if (!existingFeed.length) {
    const mapping: Record<string, number[]> = {}
    for (let i = 0; i <= 36; i++) {
      mapping[String(i)] = [...VIP_FEED_TABLE[i]!]
    }
    await db.insert(schema.feedTables).values({
      id: BUILTIN_VIP_FEED_TABLE_ID,
      name: 'Built-in VIP grid',
      mappingJson: JSON.stringify(mapping),
      createdAt: now,
      updatedAt: now
    })
    logger.log('info', 'Seeded default VIP feed table', { id: BUILTIN_VIP_FEED_TABLE_ID })
  }

  for (const b of BUILTIN_STRATEGY_ENTRIES) {
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

  await db.delete(schema.strategies).where(inArray(schema.strategies.id, [...LEGACY_BUILTIN_STRATEGY_IDS]))
  logger.log('info', 'Removed legacy built-in presets if present', {
    ids: [...LEGACY_BUILTIN_STRATEGY_IDS]
  })
}
