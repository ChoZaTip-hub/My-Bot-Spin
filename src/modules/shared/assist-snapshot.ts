/** Payload for the floating Assist window (VIP-five sessions). */
export type AssistSnapshot =
  | { kind: 'idle'; reason?: string }
  | {
      kind: 'vip_five'
      strategyName: string
      sessionId: string
      paused: boolean
      /** Five numbers for the open bet */
      betNumbers: number[]
      chipsPerNumber: number
      baseUnit: number
      /** Stake for full round (5 straight) in table currency */
      stakePerRoundMoney: number
      /** VIP chip progression tier index 0–3 → 1,2,5,10 chips */
      levelIndex: number
      /** Completed VIP rounds (boolean outcomes) */
      roundsCompleted: number
      /** Model chip P/L from progression rules */
      vipChipBalance: number
      /** Table balance delta vs session start when observer exposes balance */
      tablePnLMoney: number | null
      /** Last resolved spin (previous round) */
      lastSpin: number | null
      /** Hit on last resolved round */
      lastHit: boolean | null
      /** Money change on last round if computable */
      lastRoundMoneyDelta: number | null
      /** Feed anchor outcome used to pick the five numbers */
      feedAnchor: number | null
      /** Waiting for wheel after bet placed */
      awaitingOutcome: boolean
    }
