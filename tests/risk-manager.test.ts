import { describe, expect, it } from 'vitest'
import { applyRiskToDecision } from '@modules/risk-manager/manager'

describe('risk-manager', () => {
  it('halts on stop-loss', () => {
    const proposed = {
      action: 'PLACE_BET' as const,
      reason: 'bet',
      stakePlan: [],
      riskFlags: [] as string[],
      requiresConfirmation: false,
      metadata: {}
    }
    const res = applyRiskToDecision(
      proposed,
      {
        sessionLoss: 100,
        sessionProfit: 0,
        progressionDepth: 1,
        sessionStartedAt: 0,
        now: 10_000,
        totalBetsPlaced: 5,
        lastBetAt: 9000,
        emergencyHalt: false
      },
      { stopLoss: 50 }
    )
    expect(res.halted).toBe(true)
    expect(res.decision.action).toBe('HALT')
    expect(res.riskFlags).toContain('stop_loss')
  })

  it('waits on cooldown', () => {
    const proposed = {
      action: 'PLACE_BET' as const,
      reason: 'bet',
      stakePlan: [],
      riskFlags: [] as string[],
      requiresConfirmation: false,
      metadata: {}
    }
    const res = applyRiskToDecision(
      proposed,
      {
        sessionLoss: 0,
        sessionProfit: 0,
        progressionDepth: 0,
        sessionStartedAt: 0,
        now: 1000,
        totalBetsPlaced: 1,
        lastBetAt: 1000,
        emergencyHalt: false
      },
      { cooldownMs: 5000 }
    )
    expect(res.decision.action).toBe('WAIT')
    expect(res.riskFlags).toContain('cooldown_active')
  })
})
