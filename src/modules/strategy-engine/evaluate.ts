import type { BetInstruction, BetType } from '@modules/shared/decision'
import {
  columnOf,
  dozenOf,
  isBlack,
  isEven,
  isHigh,
  isLow,
  isRed,
  payoutMultiplier
} from '@modules/shared/roulette'
import type { StrategyConfig } from '@modules/shared/strategy-config'

function numbersForCustomTable(strategy: StrategyConfig, name: string): Set<number> {
  const t = strategy.customTables.find((c) => c.name === name)
  if (!t) return new Set()
  return new Set(t.numbers)
}

export function betTypeAndTargetForPrimary(strategy: StrategyConfig): { betType: BetType; target: string | number } {
  const p = strategy.primaryTarget
  switch (p.kind) {
    case 'red':
      return { betType: 'red', target: 'red' }
    case 'black':
      return { betType: 'black', target: 'black' }
    case 'even':
      return { betType: 'even', target: 'even' }
    case 'odd':
      return { betType: 'odd', target: 'odd' }
    case 'low':
      return { betType: 'low', target: 'low' }
    case 'high':
      return { betType: 'high', target: 'high' }
    case 'dozen':
      return { betType: 'dozen', target: p.dozen }
    case 'column':
      return { betType: 'column', target: p.column }
    case 'straight':
      return { betType: 'straight', target: p.number }
    case 'group':
      return { betType: 'group', target: p.name }
    case 'custom_table':
      return { betType: 'custom_table', target: p.tableName }
  }
}

function isWinningSpinForTarget(
  strategy: StrategyConfig,
  spin: number,
  betType: BetType,
  target: string | number
): boolean {
  if (spin < 0 || spin > 36) return false
  switch (betType) {
    case 'red':
      return isRed(spin)
    case 'black':
      return isBlack(spin)
    case 'even':
      return isEven(spin)
    case 'odd':
      return !isEven(spin) && spin !== 0
    case 'low':
      return isLow(spin)
    case 'high':
      return isHigh(spin)
    case 'dozen':
      return dozenOf(spin) === target
    case 'column':
      return columnOf(spin) === target
    case 'straight':
      return spin === target
    case 'group': {
      const set = numbersForCustomTable(strategy, String(target))
      return set.has(spin)
    }
    case 'custom_table': {
      const set = numbersForCustomTable(strategy, String(target))
      return set.has(spin)
    }
    default:
      return false
  }
}

/** True if the last resolved spin wins the given hypothetical bet. */
export function spinResolvesBet(
  strategy: StrategyConfig,
  spin: number,
  instruction: Pick<BetInstruction, 'betType' | 'target'>
): boolean {
  return isWinningSpinForTarget(strategy, spin, instruction.betType, instruction.target)
}

export function expectedStake(strategy: StrategyConfig, progressionStep: number): number {
  const { baseUnit, progression } = strategy
  if (progression.type === 'flat') {
    return baseUnit * progression.multiplier
  }
  if (progression.type === 'vip_five') {
    return 0
  }
  const idx = Math.min(progressionStep, progression.multipliers.length - 1)
  return baseUnit * progression.multipliers[idx]!
}

export function grossPayoutOnWin(instruction: BetInstruction): number {
  const mult = payoutMultiplier(instruction.betType)
  return instruction.amount * (mult + 1)
}
