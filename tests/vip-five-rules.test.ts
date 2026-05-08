import { describe, expect, it } from 'vitest'
import {
  chipsPerNumberForNextBet,
  computeVipSessionBalance,
  deriveVipProgress,
  VIP_CHIPS_PER_LEVEL,
  vipSessionSuccess
} from '@modules/vip-five/vip-progress'
import { deriveLevelReference, makeDeterministicBoolSeq } from './helpers/vip-reference'

describe('VIP-five rules', () => {
  it('starts at level 0 with empty history', () => {
    expect(chipsPerNumberForNextBet([])).toBe(VIP_CHIPS_PER_LEVEL[0])
    expect(deriveVipProgress([])).toEqual({
      levelIndex: 0,
      raiseStartRound: null,
      escalationSegmentStart: null
    })
  })

  it('computes balance for one losing round at level 0', () => {
    const rw = [false]
    expect(computeVipSessionBalance(rw)).toBe(-5)
  })

  it('computes balance for one winning round at level 0', () => {
    const rw = [true]
    expect(computeVipSessionBalance(rw)).toBe(1 * 36 - 5)
  })

  it('raises level after block of 20 with <2 wins', () => {
    const rw = Array.from({ length: 20 }, () => false)
    const st = deriveVipProgress(rw)
    expect(st.levelIndex).toBe(1)
    expect(st.raiseStartRound).toBe(21)
    expect(st.escalationSegmentStart).toBe(21)
    expect(chipsPerNumberForNextBet(rw)).toBe(VIP_CHIPS_PER_LEVEL[1])
  })

  it('success when balance reaches 800 chips', () => {
    /** Synthetic long win streak at min stake to inflate balance — property-style smoke */
    expect(vipSessionSuccess(Array.from({ length: 1000 }, () => true))).toBe(true)
  })

  it('full reset happens after raise when sliding 26-window has >= 6 wins', () => {
    const rw = [
      ...Array.from({ length: 20 }, () => false),
      ...Array.from({ length: 26 }, (_, i) => i < 6)
    ]
    const st = deriveVipProgress(rw)
    // Reset occurs, then the same round can re-enter raise logic.
    expect(st.levelIndex).toBe(1)
    expect(st.raiseStartRound).toBe(47)
    expect(st.escalationSegmentStart).toBe(47)
  })

  it('after first raise, future raise checks use fixed 20-round segments', () => {
    const rw = [
      ...Array.from({ length: 20 }, () => false), // raise to level 1
      ...Array.from({ length: 20 }, (_, i) => i < 2), // first fixed segment wins = 2
      ...Array.from({ length: 20 }, () => false) // second fixed segment wins < 2 => raise
    ]
    const st = deriveVipProgress(rw)
    expect(st.levelIndex).toBe(2)
    expect(st.raiseStartRound).toBe(61)
    expect(st.escalationSegmentStart).toBe(61)
  })

  it('does not apply one-step downgrade rule', () => {
    const rw = [
      ...Array.from({ length: 20 }, () => false), // raise to 1
      ...Array.from({ length: 26 }, (_, i) => i < 5) // no reset because wins = 5 < 6
    ]
    const st = deriveVipProgress(rw)
    expect(st.levelIndex).toBe(1)
  })

  it('matches pseudocode reference deriveLevel across representative scenarios', () => {
    const scenarios: boolean[][] = [
      [],
      [false],
      Array.from({ length: 20 }, () => false),
      [...Array.from({ length: 20 }, () => false), ...Array.from({ length: 26 }, (_, i) => i < 6)],
      [
        ...Array.from({ length: 20 }, () => false),
        ...Array.from({ length: 20 }, (_, i) => i < 2),
        ...Array.from({ length: 20 }, () => false)
      ],
      [
        ...Array.from({ length: 20 }, () => false),
        ...Array.from({ length: 26 }, (_, i) => i < 5),
        ...Array.from({ length: 20 }, () => false),
        ...Array.from({ length: 20 }, () => false)
      ],
      Array.from({ length: 120 }, (_, i) => i % 17 === 0),
      Array.from({ length: 120 }, (_, i) => i % 5 === 0)
    ]

    for (const rw of scenarios) {
      const actual = deriveVipProgress(rw).levelIndex
      const expected = deriveLevelReference(rw)
      expect(actual).toBe(expected)
    }
  })

  it('matches reference across deterministic randomized sequences', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const length = 40 + (seed % 161)
      const rw = makeDeterministicBoolSeq(length, seed)
      const actual = deriveVipProgress(rw).levelIndex
      const expected = deriveLevelReference(rw)
      expect(actual).toBe(expected)
    }
  })
})
