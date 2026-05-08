import type { BetInstruction } from '@modules/shared/decision'
import type { ExecutorResult, TableExecutor } from '@modules/executor/types'
import type { Page } from 'playwright'

function firstError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Best-effort executor for Fresh Casino / Galaxsys Roulette X table.
 * It relies on visible text labels and may need selector tuning per UI update.
 */
export class GalaxsysRouletteXExecutor implements TableExecutor {
  readonly id = 'galaxsys-roulettex'

  constructor(private readonly page: Page) {}

  private async clickChip(amount: number): Promise<void> {
    const raw = String(amount)
    const amountRx = new RegExp(`^\\s*${escapeRegex(raw)}(?:[.,]0+)?\\s*$`)
    const scope = this.page.locator('button, [role="button"], div, span')
    const chip = scope.filter({ hasText: amountRx }).first()
    await chip.click({ timeout: 1500 })
  }

  private async clickStraightNumber(target: number): Promise<void> {
    const numberRx = new RegExp(`^\\s*${target}\\s*$`)
    const boardCandidates = this.page
      .locator('div, section, article')
      .filter({ hasText: /2to1|1st12|2nd12|3rd12/i })
    const board = (await boardCandidates.count()) > 0 ? boardCandidates.first() : this.page.locator('body')
    await board.locator('button, [role="button"], div, span').filter({ hasText: numberRx }).first().click({ timeout: 2000 })
  }

  async placeBet(instructions: BetInstruction[]): Promise<ExecutorResult> {
    try {
      if (!instructions.length) return { ok: true }
      const firstAmount = instructions[0]!.amount
      await this.clickChip(firstAmount)
      for (const instr of instructions) {
        if (instr.betType !== 'straight' || typeof instr.target !== 'number') {
          return { ok: false, error: `Unsupported instruction for Galaxsys executor: ${instr.betType}` }
        }
        await this.clickStraightNumber(instr.target)
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `placeBet failed: ${firstError(err)}` }
    }
  }

  async clearBet(): Promise<ExecutorResult> {
    try {
      const btn = this.page
        .locator('button, [role="button"], div, span')
        .filter({ hasText: /clear|очист|cancel|отмен/i })
        .first()
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 800 })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `clearBet failed: ${firstError(err)}` }
    }
  }

  async confirmBet(): Promise<ExecutorResult> {
    try {
      const btn = this.page
        .locator('button, [role="button"], div, span')
        .filter({ hasText: /confirm|bet|spin|ставк|подтвер/i })
        .first()
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 800 })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `confirmBet failed: ${firstError(err)}` }
    }
  }

  async waitForResult(timeoutMs: number): Promise<ExecutorResult & { outcomeNumber?: number }> {
    try {
      await this.page.waitForTimeout(Math.max(250, Math.min(timeoutMs, 10_000)))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `waitForResult failed: ${firstError(err)}` }
    }
  }
}
