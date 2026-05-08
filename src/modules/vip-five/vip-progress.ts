/** Chips per number for levelIndex 0..3 */
export const VIP_CHIPS_PER_LEVEL = [1, 2, 5, 10] as const

/** Full reset after raise when a 26-round sliding window has enough wins. */
export const VIP_RESET_MIN_WINS_IN_LAST26 = 6

export type VipProgressState = {
  levelIndex: number
  raiseStartRound: number | null
  escalationSegmentStart: number | null
}

/**
 * Replay full round history and apply VIP rules:
 * - Raise phase A: until first raise, check sliding last-20 after every round.
 * - Raise phase B: after first raise, check non-overlapping 20-round segments.
 * - Full reset: only after raise and only for windows fully after last raise start,
 *   sliding 26 rounds; reset to level 0 when wins >= 6.
 */
export function deriveVipProgress(roundWins: readonly boolean[]): VipProgressState {
  let levelIndex = 0
  let raiseStartRound: number | null = null
  let escalationSegmentStart: number | null = null
  const n = roundWins.length
  const blockSize = 20
  const resetWindowLen = 26

  for (let i = 0; i < n; i++) {
    const played = i + 1
    const seen = roundWins.slice(0, played)

    if (levelIndex > 0 && raiseStartRound !== null) {
      const windowStart = Math.max(raiseStartRound, played - 25)
      const windowLength = played - windowStart + 1
      if (windowLength >= resetWindowLen) {
        let wins26 = 0
        for (let j = windowStart - 1; j < windowStart - 1 + resetWindowLen; j++) {
          if (seen[j]) wins26++
        }
        if (wins26 >= VIP_RESET_MIN_WINS_IN_LAST26) {
          levelIndex = 0
          raiseStartRound = null
          escalationSegmentStart = null
        }
      }
    }

    if (escalationSegmentStart === null) {
      if (played >= blockSize) {
        let wins20 = 0
        for (let j = played - blockSize; j < played; j++) {
          if (seen[j]) wins20++
        }
        if (wins20 < 2) {
          const next = Math.min(levelIndex + 1, 3)
          if (next > levelIndex) {
            levelIndex = next
            raiseStartRound = played + 1
            escalationSegmentStart = played + 1
          }
        }
      }
    } else if (played >= escalationSegmentStart + blockSize - 1) {
      let winsSeg = 0
      const segStart = escalationSegmentStart - 1
      for (let j = segStart; j < segStart + blockSize; j++) {
        if (seen[j]) winsSeg++
      }
      if (winsSeg < 2) {
        const next = Math.min(levelIndex + 1, 3)
        if (next > levelIndex) {
          levelIndex = next
          raiseStartRound = played + 1
          escalationSegmentStart = played + 1
        } else {
          escalationSegmentStart += blockSize
        }
      } else {
        escalationSegmentStart += blockSize
      }
    }
  }

  return { levelIndex, raiseStartRound, escalationSegmentStart }
}

export function chipsPerNumberForNextBet(roundWinsCompleted: readonly boolean[]): number {
  const { levelIndex } = deriveVipProgress(roundWinsCompleted)
  return VIP_CHIPS_PER_LEVEL[levelIndex]!
}

/** Session chip balance from zero; each round uses level derived from all prior rounds only. */
export function computeVipSessionBalance(roundWins: readonly boolean[]): number {
  let balance = 0
  for (let r = 1; r <= roundWins.length; r++) {
    const prior = roundWins.slice(0, r - 1)
    const levelIndex = deriveVipProgress(prior).levelIndex
    const chips = VIP_CHIPS_PER_LEVEL[levelIndex]!
    const fullRound = 5 * chips
    const won = roundWins[r - 1]!
    if (won) {
      balance += chips * 36 - fullRound
    } else {
      balance -= fullRound
    }
  }
  return balance
}

export function totalRoundWins(roundWins: readonly boolean[]): number {
  return roundWins.filter(Boolean).length
}

/** Success: balance ≥ 800 chips OR ≥ 1000 winning rounds */
export function vipSessionSuccess(roundWins: readonly boolean[]): boolean {
  return computeVipSessionBalance(roundWins) >= 800 || totalRoundWins(roundWins) >= 1000
}

export function roundOutcomeHit(spin: number, numbers: readonly number[]): boolean {
  return numbers.includes(spin)
}
