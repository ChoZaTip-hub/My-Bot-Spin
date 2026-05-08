export function deriveLevelReference(roundWins: boolean[]): number {
  let levelIndex = 0
  const blockSize = 20
  const resetWindowLen = 26
  let raiseStartRound: number | null = null
  let escalationSegmentStart: number | null = null

  for (let i = 0; i < roundWins.length; i++) {
    const played = i + 1
    const seen = roundWins.slice(0, played)
    if (levelIndex > 0 && raiseStartRound != null) {
      const windowStart = Math.max(raiseStartRound, played - 25)
      const windowLength = played - windowStart + 1
      if (windowLength >= resetWindowLen) {
        const wins26 = seen
          .slice(windowStart - 1, windowStart - 1 + resetWindowLen)
          .filter(Boolean).length
        if (wins26 >= 6) {
          levelIndex = 0
          raiseStartRound = null
          escalationSegmentStart = null
        }
      }
    }

    if (escalationSegmentStart === null) {
      if (played >= blockSize) {
        const wins20 = seen.slice(-20).filter(Boolean).length
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
      const s = escalationSegmentStart - 1
      const winsSeg = seen.slice(s, s + blockSize).filter(Boolean).length
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

  return levelIndex
}

export function makeDeterministicBoolSeq(length: number, seed: number): boolean[] {
  let state = seed | 0
  const out: boolean[] = []
  for (let i = 0; i < length; i++) {
    state = (1664525 * state + 1013904223) | 0
    out.push((state >>> 0) % 100 < 37)
  }
  return out
}
