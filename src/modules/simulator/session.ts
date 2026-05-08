import type { Decision } from '@modules/shared/decision'
import type { StrategyConfig } from '@modules/shared/strategy-config'
import { TableConfigSchema } from '@modules/shared/strategy-config'
import { decideNextAction } from '@modules/strategy-engine/engine'
import { grossPayoutOnWin, spinResolvesBet } from '@modules/strategy-engine/evaluate'
import type { SessionSummary } from './metrics'

export type SimulationState = {
  bankroll: number
  spinHistory: number[]
  progressionStep: number
  consecutiveLosses: number
  lastBetOutcome: 'win' | 'loss' | 'none'
  peakBankroll: number
  maxDrawdown: number
  currentLossStreak: number
  currentWinStreak: number
  longestLossStreak: number
  longestWinStreak: number
  wins: number
  losses: number
  totalBets: number
}

export function initialSimulationState(initialBankroll: number): SimulationState {
  return {
    bankroll: initialBankroll,
    spinHistory: [],
    progressionStep: 0,
    consecutiveLosses: 0,
    lastBetOutcome: 'none',
    peakBankroll: initialBankroll,
    maxDrawdown: 0,
    currentLossStreak: 0,
    currentWinStreak: 0,
    longestLossStreak: 0,
    longestWinStreak: 0,
    wins: 0,
    losses: 0,
    totalBets: 0
  }
}

function applyBankrollExtremes(state: SimulationState): void {
  if (state.bankroll > state.peakBankroll) {
    state.peakBankroll = state.bankroll
  }
  const dd = state.peakBankroll - state.bankroll
  if (dd > state.maxDrawdown) state.maxDrawdown = dd
}

function updateStreaks(state: SimulationState, won: boolean): void {
  if (won) {
    state.currentWinStreak += 1
    state.currentLossStreak = 0
    if (state.currentWinStreak > state.longestWinStreak) {
      state.longestWinStreak = state.currentWinStreak
    }
  } else {
    state.currentLossStreak += 1
    state.currentWinStreak = 0
    if (state.currentLossStreak > state.longestLossStreak) {
      state.longestLossStreak = state.currentLossStreak
    }
  }
}

function advanceProgression(strategy: StrategyConfig, state: SimulationState, won: boolean): void {
  if (won) {
    state.lastBetOutcome = 'win'
    state.consecutiveLosses = 0
    if (strategy.resetOnWin) {
      state.progressionStep = 0
    }
    state.wins += 1
    updateStreaks(state, true)
    return
  }
  state.lastBetOutcome = 'loss'
  state.consecutiveLosses += 1
  if (strategy.progression.type === 'sequence') {
    state.progressionStep = Math.min(
      state.progressionStep + 1,
      strategy.progression.multipliers.length - 1
    )
  }
  state.losses += 1
  updateStreaks(state, false)
}

/**
 * Run one virtual session for `spinCount` spins using `nextSpin` provider.
 */
export function runVirtualSession(
  strategy: StrategyConfig,
  spinCount: number,
  initialBankroll: number,
  nextSpin: () => number
): { state: SimulationState; bankrollCurve: number[]; decisions: Decision[] } {
  const table = TableConfigSchema.parse({ wheel: 'european' })
  const state = initialSimulationState(initialBankroll)
  const bankrollCurve: number[] = [state.bankroll]
  const decisions: Decision[] = []

  for (let i = 0; i < spinCount; i += 1) {
    const engineInput = {
      bankroll: state.bankroll,
      spinHistory: state.spinHistory,
      strategy,
      table,
      progressionStep: state.progressionStep,
      consecutiveLosses: state.consecutiveLosses,
      lastBetOutcome: state.lastBetOutcome
    }
    const d = decideNextAction(engineInput)
    decisions.push(d)

    if (d.action === 'HALT') {
      break
    }

    if (d.action === 'PLACE_BET' && d.stakePlan?.[0]) {
      const instr = d.stakePlan[0]
      state.bankroll -= instr.amount
      state.totalBets += 1
      applyBankrollExtremes(state)

      const spin = nextSpin()
      state.spinHistory.push(spin)
      const won = spinResolvesBet(strategy, spin, instr)
      if (won) {
        state.bankroll += grossPayoutOnWin(instr)
        advanceProgression(strategy, state, true)
      } else {
        advanceProgression(strategy, state, false)
      }
    } else {
      const spin = nextSpin()
      state.spinHistory.push(spin)
      state.lastBetOutcome = 'none'
    }

    applyBankrollExtremes(state)
    bankrollCurve.push(state.bankroll)
  }

  return { state, bankrollCurve, decisions }
}

export function stateToSummary(state: SimulationState): SessionSummary {
  return {
    endingBankroll: state.bankroll,
    maxDrawdown: state.maxDrawdown,
    longestLossStreak: state.longestLossStreak,
    longestWinStreak: state.longestWinStreak,
    wins: state.wins,
    losses: state.losses,
    totalBets: state.totalBets
  }
}
