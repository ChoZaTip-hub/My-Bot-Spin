import type { SectorId } from '@modules/shared/sector-analytics'
import type { VipFeedSelection } from '@modules/shared/strategy-config'
import { numbersByLastOutcome } from './vip-feed'

const DEFAULT_MIN_SPINS_DOMINANT = 18

function rowFromMap(
  maps: ReadonlyMap<string, Readonly<Record<number, readonly number[]>>>,
  tableId: string,
  outcome: number
): readonly number[] {
  const m = maps.get(tableId)
  if (!m) {
    throw new Error(`VIP feed table "${tableId}" is not loaded`)
  }
  const row = m[outcome]
  if (!row || row.length !== 5) {
    throw new Error(`VIP feed table "${tableId}" has no valid row for outcome ${outcome}`)
  }
  return row
}

/**
 * Build resolver for «last spin outcome → five straight numbers» used by {@link buildVipFiveDecision}.
 * - `builtin` / omitted: shipped {@link VIP_FEED_TABLE}
 * - `fixed`: one saved mapping from DB
 * - `dominant_sector`: pick mapping by dominant wheel sector of session spins (after min spin count)
 */
export function createVipFeedRowResolver(opts: {
  selection: VipFeedSelection | undefined
  tableMaps: ReadonlyMap<string, Readonly<Record<number, readonly number[]>>>
  getDominantSector: () => SectorId | null
  getSpinCount: () => number
}): (outcome: number) => readonly number[] {
  const sel = opts.selection

  const builtin = (outcome: number): readonly number[] => [...numbersByLastOutcome(outcome)]

  if (!sel || sel.kind === 'builtin') {
    return builtin
  }

  if (sel.kind === 'fixed') {
    return (outcome) => rowFromMap(opts.tableMaps, sel.tableId, outcome)
  }

  const minSpins = sel.minSpinsBeforeSwitch ?? DEFAULT_MIN_SPINS_DOMINANT

  return (outcome) => {
    if (opts.getSpinCount() < minSpins) {
      return builtin(outcome)
    }
    const dom = opts.getDominantSector()
    const tableId =
      dom === 'voisins'
        ? sel.voisinsTableId
        : dom === 'tiers'
          ? sel.tiersTableId
          : dom === 'orphelins'
            ? sel.orphelinsTableId
            : sel.tiersTableId
    return rowFromMap(opts.tableMaps, tableId, outcome)
  }
}
