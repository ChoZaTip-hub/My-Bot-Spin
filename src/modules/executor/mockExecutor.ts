import type { BetInstruction } from '@modules/shared/decision'
import type { ExecutorResult, TableExecutor } from './types'

export class MockTableExecutor implements TableExecutor {
  readonly id = 'mock'

  async placeBet(_instructions: BetInstruction[]): Promise<ExecutorResult> {
    return { ok: true }
  }

  async clearBet(): Promise<ExecutorResult> {
    return { ok: true }
  }

  async confirmBet(): Promise<ExecutorResult> {
    return { ok: true }
  }

  async waitForResult(_timeoutMs: number): Promise<ExecutorResult & { outcomeNumber?: number }> {
    return { ok: true, outcomeNumber: 0 }
  }
}
