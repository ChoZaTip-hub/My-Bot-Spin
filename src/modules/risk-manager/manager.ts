import type { Decision } from '@modules/shared/decision'
import { decisionHalt, decisionWait } from '@modules/shared/decision'
import type { RiskLimits, RiskManagerInput } from './types'

export type RiskEvaluation = {
  halted: boolean
  riskFlags: string[]
  /** Mutated decision when halt forces HALT */
  decision: Decision
}

function buildFlags(input: RiskManagerInput, limits: RiskLimits): string[] {
  const flags: string[] = []
  if (limits.stopLoss !== undefined && input.sessionLoss >= limits.stopLoss) {
    flags.push('stop_loss')
  }
  if (limits.stopWin !== undefined && input.sessionProfit >= limits.stopWin) {
    flags.push('stop_win')
  }
  if (limits.maxProgressionDepth !== undefined && input.progressionDepth >= limits.maxProgressionDepth) {
    flags.push('max_progression_depth')
  }
  if (limits.maxSessionMs !== undefined && input.now - input.sessionStartedAt >= limits.maxSessionMs) {
    flags.push('max_session_duration')
  }
  if (limits.maxTotalBets !== undefined && input.totalBetsPlaced >= limits.maxTotalBets) {
    flags.push('max_total_bets')
  }
  if (
    limits.cooldownMs !== undefined &&
    limits.cooldownMs > 0 &&
    input.lastBetAt !== null &&
    input.now - input.lastBetAt < limits.cooldownMs
  ) {
    flags.push('cooldown_active')
  }
  if (input.emergencyHalt) {
    flags.push('emergency_halt')
  }
  return flags
}

/**
 * Applies risk limits to a proposed engine decision.
 */
export function applyRiskToDecision(
  proposed: Decision,
  input: RiskManagerInput,
  limits: RiskLimits
): RiskEvaluation {
  const riskFlags = [...proposed.riskFlags, ...buildFlags(input, limits)]

  if (input.emergencyHalt) {
    return {
      halted: true,
      riskFlags,
      decision: decisionHalt('Emergency halt engaged', riskFlags)
    }
  }

  const hardHalt =
    riskFlags.includes('stop_loss') ||
    riskFlags.includes('max_progression_depth') ||
    riskFlags.includes('max_session_duration') ||
    riskFlags.includes('max_total_bets')

  if (hardHalt) {
    return {
      halted: true,
      riskFlags,
      decision: decisionHalt('Risk limits triggered session halt', riskFlags)
    }
  }

  if (riskFlags.includes('stop_win')) {
    return {
      halted: true,
      riskFlags,
      decision: decisionHalt('Stop-win reached', riskFlags)
    }
  }

  if (riskFlags.includes('cooldown_active')) {
    return {
      halted: false,
      riskFlags,
      decision: decisionWait('Cool-down period active', riskFlags)
    }
  }

  return {
    halted: false,
    riskFlags,
    decision: { ...proposed, riskFlags }
  }
}
