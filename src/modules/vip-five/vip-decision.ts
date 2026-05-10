import type { Decision } from '@modules/shared/decision'
import type { StrategyConfig } from '@modules/shared/strategy-config'
import { chipsPerNumberForNextBet } from './vip-progress'
import { numbersByLastOutcome } from './vip-feed'

const defaultResolveRow = (outcome: number): readonly number[] => [...numbersByLastOutcome(outcome)]

function isVipFive(strategy: StrategyConfig): strategy is StrategyConfig & {
  progression: { type: 'vip_five'; numbers: number[] }
} {
  return strategy.progression.type === 'vip_five'
}

export function buildVipFiveDecision(
  strategy: StrategyConfig,
  vipRoundWinsCompleted: readonly boolean[],
  lastOutcomeNumber: number | null,
  resolveRow: (outcome: number) => readonly number[] = defaultResolveRow
): Decision {
  if (!isVipFive(strategy)) {
    throw new Error('buildVipFiveDecision: not a vip_five strategy')
  }
  const numbers =
    lastOutcomeNumber === null ? strategy.progression.numbers : [...resolveRow(lastOutcomeNumber)]
  const chips = chipsPerNumberForNextBet(vipRoundWinsCompleted)
  const stakePlan = numbers.map((n, idx) => ({
    betType: 'straight' as const,
    target: n,
    amount: chips,
    sequenceIndex: vipRoundWinsCompleted.length,
    notes: idx === 0 ? strategy.name : undefined
  }))

  return {
    action: 'PLACE_BET',
    reason: `VIP five: ${chips} chips × 5 numbers (feed by last outcome ${lastOutcomeNumber ?? 'n/a'})`,
    stakePlan,
    riskFlags: [],
    requiresConfirmation: false,
    metadata: {
      vipFive: true,
      chipsPerNumber: chips,
      numbers,
      feedSourceOutcome: lastOutcomeNumber,
      completedRounds: vipRoundWinsCompleted.length
    }
  }
}
