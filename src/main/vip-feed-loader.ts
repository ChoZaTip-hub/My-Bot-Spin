import { inArray } from 'drizzle-orm'
import type { DbClient } from '@modules/db/client'
import * as schema from '@modules/db/schema'
import type { SectorId } from '@modules/shared/sector-analytics'
import { parseFeedTableMappingJson } from '@modules/shared/feed-table-mapping'
import type { StrategyConfig, VipFeedSelection } from '@modules/shared/strategy-config'
import { createVipFeedRowResolver } from '@modules/vip-five/vip-row-resolver'

function collectFeedTableIds(sel: VipFeedSelection | undefined): string[] {
  if (!sel || sel.kind === 'builtin') return []
  if (sel.kind === 'fixed') return [sel.tableId]
  return [sel.voisinsTableId, sel.tiersTableId, sel.orphelinsTableId]
}

export async function loadVipFeedRowResolver(
  db: DbClient['db'],
  strategy: StrategyConfig,
  getDominantSector: () => SectorId | null,
  getSpinCount: () => number
): Promise<(outcome: number) => readonly number[]> {
  if (strategy.progression.type !== 'vip_five') {
    throw new Error('loadVipFeedRowResolver: strategy is not vip_five')
  }
  const sel = strategy.progression.feedSelection
  const ids = collectFeedTableIds(sel)
  const maps = new Map<string, Readonly<Record<number, readonly number[]>>>()

  if (ids.length > 0) {
    const rows = await db.select().from(schema.feedTables).where(inArray(schema.feedTables.id, ids))
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const id of ids) {
      const row = byId.get(id)
      if (!row) {
        throw new Error(
          `Feed table "${id}" not found. Create it under «Feed tables» or fix progression.feedSelection in strategy JSON.`
        )
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(row.mappingJson)
      } catch {
        throw new Error(`Feed table "${id}" has invalid JSON`)
      }
      maps.set(id, parseFeedTableMappingJson(parsed))
    }
  }

  return createVipFeedRowResolver({
    selection: sel,
    tableMaps: maps,
    getDominantSector,
    getSpinCount
  })
}
