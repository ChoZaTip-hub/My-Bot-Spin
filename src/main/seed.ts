import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { DbClient } from '@modules/db/client'
import * as schema from '@modules/db/schema'
import { BUILTIN_STRATEGY_ENTRIES } from '@modules/shared/builtin-strategies'
import { StrategyConfigSchema } from '@modules/shared/strategy-config'
import type { Logger } from './logger'

export async function seedIfEmpty(db: DbClient['db'], logger: Logger): Promise<void> {
  logger.log('info', 'Ensuring built-in strategies')
  const now = new Date()
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
}
