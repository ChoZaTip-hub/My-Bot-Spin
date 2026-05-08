export type RiskManagerInput = {
  /** Absolute loss from session start */
  sessionLoss: number
  /** Absolute profit from session start */
  sessionProfit: number
  progressionDepth: number
  sessionStartedAt: number
  now: number
  totalBetsPlaced: number
  lastBetAt: number | null
  emergencyHalt: boolean
}

export type RiskLimits = {
  stopLoss?: number
  stopWin?: number
  maxProgressionDepth?: number
  maxSessionMs?: number
  maxTotalBets?: number
  cooldownMs?: number
}
