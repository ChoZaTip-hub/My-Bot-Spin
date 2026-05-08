import { describe, expect, it } from 'vitest'
import { numbersByLastOutcome } from '@modules/vip-five/vip-feed'

describe('VIP feed table', () => {
  it('returns five mapped numbers for known outcomes', () => {
    expect(numbersByLastOutcome(0)).toEqual([2, 1, 19, 4, 8])
    expect(numbersByLastOutcome(24)).toEqual([5, 10, 33, 24, 16])
    expect(numbersByLastOutcome(36)).toEqual([36, 33, 35, 18, 29])
  })

  it('throws for invalid outcomes', () => {
    expect(() => numbersByLastOutcome(-1)).toThrow()
    expect(() => numbersByLastOutcome(37)).toThrow()
  })
})
