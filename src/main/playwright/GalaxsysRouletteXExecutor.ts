import type { BetInstruction } from '@modules/shared/decision'
import type { ExecutorResult, TableExecutor } from '@modules/executor/types'
import type { Frame, Page } from 'playwright'

function firstError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Layout hints on EU / RU roulette boards */
const BOARD_HINT_RX =
  /2to1|1st12|2nd12|3rd12|2\s*к\s*1|12\s*(первая|вторая|третья)|ставки|place\s+your\s+bets/i

type LocatorRoot = Page | Frame

/**
 * Best-effort executor for Fresh Casino / Galaxsys Roulette X table.
 * It relies on visible text labels and may need selector tuning per UI update.
 * The game usually runs inside an iframe — we locate the frame before clicking.
 */
export class GalaxsysRouletteXExecutor implements TableExecutor {
  readonly id = 'galaxsys-roulettex'

  constructor(private readonly page: Page) {}

  /** Prefer the iframe that actually contains the betting grid (not the outer shell). */
  private async getLocatorRoot(): Promise<LocatorRoot> {
    for (const frame of this.page.frames()) {
      try {
        const candidates = frame.locator('div, section, article').filter({ hasText: BOARD_HINT_RX })
        if ((await candidates.count()) > 0) return frame
      } catch {
        continue
      }
    }
    return this.page
  }

  private async clickChip(amount: number, root: LocatorRoot): Promise<void> {
    const raw = String(amount)
    const amountRx = new RegExp(`^\\s*${escapeRegex(raw)}(?:[.,]0+)?\\s*$`)
    const scope = root.locator('button, [role="button"], div, span')
    const chip = scope.filter({ hasText: amountRx }).first()
    await chip.click({ timeout: 2500 })
  }

  private async clickStraightNumber(target: number, root: LocatorRoot): Promise<void> {
    const numberRx = new RegExp(`^\\s*${target}\\s*$`)
    const boardCandidates = root
      .locator('div, section, article')
      .filter({ hasText: BOARD_HINT_RX })
    const board = (await boardCandidates.count()) > 0 ? boardCandidates.first() : root.locator('body')
    await board.locator('button, [role="button"], div, span').filter({ hasText: numberRx }).first().click({
      timeout: 2500
    })
  }

  private async confirmBetOn(root: LocatorRoot): Promise<ExecutorResult> {
    try {
      const btn = root
        .locator('button, [role="button"], div, span')
        .filter({ hasText: /confirm|bet|spin|ставк|подтвер/i })
        .first()
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 1200 })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `confirmBet failed: ${firstError(err)}` }
    }
  }

  async placeBet(instructions: BetInstruction[]): Promise<ExecutorResult> {
    try {
      if (!instructions.length) return { ok: true }
      const root = await this.getLocatorRoot()
      const firstAmount = instructions[0]!.amount
      await this.clickChip(firstAmount, root)
      for (const instr of instructions) {
        if (instr.betType !== 'straight' || typeof instr.target !== 'number') {
          return { ok: false, error: `Unsupported instruction for Galaxsys executor: ${instr.betType}` }
        }
        await this.clickStraightNumber(instr.target, root)
      }
      const c = await this.confirmBetOn(root)
      return c.ok ? { ok: true } : c
    } catch (err) {
      return { ok: false, error: `placeBet failed: ${firstError(err)}` }
    }
  }

  async clearBet(): Promise<ExecutorResult> {
    try {
      const root = await this.getLocatorRoot()
      const btn = root
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
      const root = await this.getLocatorRoot()
      return this.confirmBetOn(root)
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
