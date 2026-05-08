import { describe, expect, it } from 'vitest'
import { sectorOf, summarizeSpinAnalytics } from '@modules/shared/sector-analytics'

describe('sector-analytics', () => {
  it('partitions 0-36', () => {
    const seen = new Set<number>()
    for (let n = 0; n <= 36; n += 1) {
      sectorOf(n)
      seen.add(n)
    }
    expect(seen.size).toBe(37)
  })

  it('summarizes spins', () => {
    const spins = [0, 7, 7, 12, 36, 36, 1]
    const s = summarizeSpinAnalytics(spins)
    expect(s.spinCount).toBe(7)
    expect(s.topNumbers.length).toBeGreaterThan(0)
    expect(s.dominantSector).not.toBeNull()
  })
})
