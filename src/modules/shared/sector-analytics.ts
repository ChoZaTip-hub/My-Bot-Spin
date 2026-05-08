/**
 * European roulette — non-overlapping partition (French-style zones on wheel layout).
 * Used for frequency analytics only (not prediction).
 */
export type SectorId = 'voisins' | 'tiers' | 'orphelins'

const VOISINS = new Set([
  0, 2, 3, 4, 7, 12, 15, 18, 19, 21, 22, 25, 26, 28, 29, 32, 35
])
const TIERS = new Set([5, 8, 10, 11, 13, 16, 23, 24, 27, 30, 33, 36])
const ORPHELINS = new Set([1, 6, 9, 14, 17, 20, 31, 34])

export function sectorOf(n: number): SectorId {
  if (VOISINS.has(n)) return 'voisins'
  if (TIERS.has(n)) return 'tiers'
  if (ORPHELINS.has(n)) return 'orphelins'
  /** Should never happen if n ∈ 0..36 */
  return 'orphelins'
}

export type SectorDistribution = Record<SectorId, number>

export type TopNumberStat = { value: number; count: number; pct: number }

export type SpinAnalyticsSummary = {
  spinCount: number
  distribution: SectorDistribution
  sectorPct: Record<SectorId, number>
  zeroPct: number
  topNumbers: TopNumberStat[]
  /** Largest sector share — descriptive only (historical frequency). */
  dominantSector: SectorId | null
  dominantSectorPct: number
}

export function summarizeSpinAnalytics(spins: number[]): SpinAnalyticsSummary {
  const valid = spins.filter((n) => n >= 0 && n <= 36)
  const n = valid.length
  const distribution: SectorDistribution = { voisins: 0, tiers: 0, orphelins: 0 }
  let zeros = 0
  const freq = new Map<number, number>()

  for (const v of valid) {
    if (v === 0) zeros += 1
    distribution[sectorOf(v)] += 1
    freq.set(v, (freq.get(v) ?? 0) + 1)
  }

  const sectorPct: Record<SectorId, number> = {
    voisins: n ? distribution.voisins / n : 0,
    tiers: n ? distribution.tiers / n : 0,
    orphelins: n ? distribution.orphelins / n : 0
  }

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])
  const topNumbers: TopNumberStat[] = sorted.slice(0, 5).map(([value, count]) => ({
    value,
    count,
    pct: n ? count / n : 0
  }))

  let dominantSector: SectorId | null = null
  let best = -1
  for (const s of ['voisins', 'tiers', 'orphelins'] as const) {
    if (distribution[s] > best) {
      best = distribution[s]
      dominantSector = s
    }
  }
  if (n === 0) dominantSector = null

  const dominantSectorPct = dominantSector && n ? distribution[dominantSector] / n : 0

  return {
    spinCount: n,
    distribution,
    sectorPct,
    zeroPct: n ? zeros / n : 0,
    topNumbers,
    dominantSector,
    dominantSectorPct
  }
}
