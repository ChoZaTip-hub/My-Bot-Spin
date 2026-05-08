import type { BetInstruction } from '@modules/shared/decision'

export type ExecutorResult = { ok: true } | { ok: false; error: string }

export interface TableExecutor {
  readonly id: string
  placeBet(instructions: BetInstruction[]): Promise<ExecutorResult>
  clearBet(): Promise<ExecutorResult>
  confirmBet(): Promise<ExecutorResult>
  waitForResult(timeoutMs: number): Promise<ExecutorResult & { outcomeNumber?: number }>
}
