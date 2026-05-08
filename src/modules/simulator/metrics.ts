export type SessionSummary = {
  endingBankroll: number
  maxDrawdown: number
  longestLossStreak: number
  longestWinStreak: number
  wins: number
  losses: number
  totalBets: number
}

export type BatchMetrics = {
  totalSessions: number
  winRate: number
  /** Sample mean of (ending - initial) / initial */
  evEstimate: number
  maxDrawdownAcrossSessions: number
  longestLossStreak: number
  longestWinStreak: number
  endingBankrollDistribution: number[]
}

export function aggregateSummaries(
  summaries: SessionSummary[],
  initialBankroll: number
): BatchMetrics {
  if (summaries.length === 0) {
    return {
      totalSessions: 0,
      winRate: 0,
      evEstimate: 0,
      maxDrawdownAcrossSessions: 0,
      longestLossStreak: 0,
      longestWinStreak: 0,
      endingBankrollDistribution: []
    }
  }
  const wins = summaries.filter((s) => s.endingBankroll > initialBankroll).length
  const evEstimate =
    summaries.reduce((acc, s) => acc + (s.endingBankroll - initialBankroll) / initialBankroll, 0) /
    summaries.length
  return {
    totalSessions: summaries.length,
    winRate: wins / summaries.length,
    evEstimate,
    maxDrawdownAcrossSessions: Math.max(...summaries.map((s) => s.maxDrawdown)),
    longestLossStreak: Math.max(...summaries.map((s) => s.longestLossStreak)),
    longestWinStreak: Math.max(...summaries.map((s) => s.longestWinStreak)),
    endingBankrollDistribution: summaries.map((s) => s.endingBankroll)
  }
}
