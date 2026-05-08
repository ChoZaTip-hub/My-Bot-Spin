import type { Decision } from '@modules/shared/decision'
import { decisionHalt, decisionNoBet, decisionWait } from '@modules/shared/decision'
import type { EngineInput } from './types'
import { betTypeAndTargetForPrimary, expectedStake } from './evaluate'

function triggerAllowsBet(input: EngineInput): boolean {
  const { strategy, spinHistory } = input
  switch (strategy.trigger.kind) {
    case 'always':
      return true
    case 'after_spin_count':
      return spinHistory.length >= strategy.trigger.minHistory
    case 'last_spin_in': {
      const last = spinHistory.at(-1)
      if (last === undefined) return false
      return strategy.trigger.numbers.includes(last)
    }
  }
}

function strategyStopHalt(input: EngineInput): string | null {
  const { strategy, bankroll, progressionStep, consecutiveLosses } = input
  const sr = strategy.stopRules
  if (sr.maxProgressionDepth !== undefined && progressionStep >= sr.maxProgressionDepth) {
    return 'Strategy stop: max progression depth reached'
  }
  if (sr.maxConsecutiveLosses !== undefined && consecutiveLosses >= sr.maxConsecutiveLosses) {
    return 'Strategy stop: max consecutive losses reached'
  }
  if (sr.maxLossAmount !== undefined && sr.maxLossAmount > 0) {
    // Without initial bankroll in engine, interpret as bankroll floor via metadata in session — skip here
  }
  if (bankroll <= 0) {
    return 'Strategy stop: bankroll depleted'
  }
  return null
}

/**
 * Pure strategy step: given history and progression state, produce the next decision.
 */
export function decideNextAction(input: EngineInput): Decision {
  if (input.strategy.progression.type === 'vip_five') {
    return decisionHalt('VIP-five progression runs in Live Session only (session-managed stakes)', ['vip_five_live_only'])
  }

  const halt = strategyStopHalt(input)
  if (halt) {
    return decisionHalt(halt, ['strategy_stop'])
  }

  if (!triggerAllowsBet(input)) {
    if (input.strategy.trigger.kind === 'after_spin_count' && input.spinHistory.length < input.strategy.trigger.minHistory) {
      return decisionWait('Waiting for enough spin history for trigger', [])
    }
    return decisionNoBet('Trigger conditions not met', [])
  }

  const stake = expectedStake(input.strategy, input.progressionStep)
  if (stake > input.bankroll) {
    return decisionHalt('Insufficient bankroll for next stake', ['insufficient_bankroll'])
  }

  const { betType, target } = betTypeAndTargetForPrimary(input.strategy)
  if (!input.strategy.allowedBetTypes.includes(betType)) {
    return decisionHalt('Bet type not allowed by strategy config', ['invalid_config'])
  }

  return {
    action: 'PLACE_BET',
    reason: 'Strategy armed; placing planned stake',
    stakePlan: [
      {
        betType,
        target,
        amount: stake,
        sequenceIndex: input.progressionStep,
        notes: input.strategy.name
      }
    ],
    riskFlags: [],
    requiresConfirmation: false,
    metadata: {
      progressionStep: input.progressionStep,
      tableName: input.strategy.tableName
    }
  }
}
