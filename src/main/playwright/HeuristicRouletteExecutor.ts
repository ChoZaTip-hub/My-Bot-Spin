import type { BetInstruction } from '@modules/shared/decision'
import type { ExecutorResult, TableExecutor } from '@modules/executor/types'
import type { RouletteHintEntry, RouletteTeachingMapping } from '../teaching/roulette-mapping'
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

/** Typical chip denominations left→right on many web roulettes */
const CHIP_STRIP_ORDER = [0.1, 1, 2, 5, 10] as const

/** Score frames for picking game iframe */
const COMMON_CHIP_VALUES = [0.1, 1, 2, 5, 10, 25, 50, 100] as const

type LocatorRoot = Page | Frame

const CLICK_TIMEOUT_MS = 8000

/**
 * Generic Playwright executor for web roulette: chip strip, number grid, confirm — with optional
 * per-table hints from recorded sessions ({@link RouletteTeachingMapping}).
 */
export class HeuristicRouletteExecutor implements TableExecutor {
  readonly id = 'heuristic-roulette'

  constructor(
    private readonly page: Page,
    private readonly mapping: RouletteTeachingMapping | null = null
  ) {}

  private findChipHint(amount: number): RouletteHintEntry | undefined {
    if (!this.mapping?.chips) return undefined
    const m = this.mapping.chips
    const direct = m[String(amount)]
    if (direct) return direct
    for (const [k, v] of Object.entries(m)) {
      const n = Number(k)
      if (Number.isFinite(n) && Math.abs(n - amount) < 1e-9) return v
    }
    return undefined
  }

  private findStraightHint(target: number): RouletteHintEntry | undefined {
    return this.mapping?.straights?.[String(target)]
  }

  private async clickHint(h: RouletteHintEntry): Promise<boolean> {
    if (h.selectorHint?.trim()) {
      const sel = h.selectorHint.trim()
      for (const fr of this.page.frames()) {
        try {
          const loc = fr.locator(sel).first()
          if ((await loc.count()) > 0) {
            await loc.scrollIntoViewIfNeeded().catch(() => undefined)
            await loc.click({ timeout: CLICK_TIMEOUT_MS, force: true })
            return true
          }
        } catch {
          continue
        }
      }
    }

    if (h.clientX != null && h.clientY != null) {
      const hintHost = h.frameUrl ? (() => {
        try {
          return new URL(h.frameUrl).hostname
        } catch {
          return ''
        }
      })() : ''

      const frames = hintHost
        ? this.page.frames().filter((f) => {
            try {
              return f.url().includes(hintHost)
            } catch {
              return false
            }
          })
        : this.page.frames()

      for (const fr of frames.length ? frames : this.page.frames()) {
        try {
          const clicked = await fr.evaluate(
            ({ cx, cy }) => {
              const el = document.elementFromPoint(cx, cy)
              if (el instanceof HTMLElement) {
                el.click()
                return true
              }
              return false
            },
            { cx: h.clientX, cy: h.clientY }
          )
          if (clicked) return true
        } catch {
          continue
        }
      }
    }

    return false
  }

  private async getBestGameFrame(): Promise<LocatorRoot> {
    let best: LocatorRoot = this.page
    let bestScore = -1

    for (const frame of this.page.frames()) {
      try {
        let score = 0
        const gridHint = await frame
          .locator('div, section, article')
          .filter({ hasText: BOARD_HINT_RX })
          .count()
        if (gridHint > 0) score += 8

        for (const v of COMMON_CHIP_VALUES) {
          const raw = String(v)
          const rx = new RegExp(`^\\s*${escapeRegex(raw)}(?:[.,]0+)?\\s*$`)
          const n = await frame.locator('button, [role="button"]').filter({ hasText: rx }).count()
          if (n > 0) score += 3
        }

        const url = frame.url().toLowerCase()
        if (/game|launch|partner|casino|table|embed|iframe|galaxsys|roulette/i.test(url)) score += 2
        if (url.startsWith('about:')) score -= 5

        if (score > bestScore) {
          bestScore = score
          best = frame
        }
      } catch {
        continue
      }
    }

    return best
  }

  /** Try DOM probe in one frame, then all frames (game often nested). */
  private async clickChipDom(amount: number): Promise<boolean> {
    const tryFrame = async (fr: Frame): Promise<boolean> => {
      try {
        return await fr.evaluate((denom: number) => {
          const EPS = 1e-9
          const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
          const CHIP_STRIP_ORDER_LOCAL = [0.1, 1, 2, 5, 10]
          const approxEq = (a: number, b: number) => Math.abs(a - b) < EPS

          function labelMatches(text: string, denom: number): boolean {
            const s = norm(text)
            if (!s || s.length > 48) return false
            if (approxEq(denom, 0.1)) {
              return /^(0[.,]1|0\.1)(?:\s*(USD|EUR|RUB|UAH|₽|\$|€|₴))?$/i.test(s)
            }
            const base = String(denom)
            const re = new RegExp(
              `^${base.replace('.', '\\.')}(?:[.,]0+)?(?:\\s*(USD|EUR|RUB|UAH|₽|\\$|€|₴))?$`,
              'i'
            )
            return re.test(s)
          }

          const clickable = Array.from(
            document.querySelectorAll<HTMLElement>(
              'button, [role="button"], [role="radio"], [tabindex="0"], a, div[role="button"]'
            )
          ).filter((el) => {
            const r = el.getBoundingClientRect()
            if (r.width < 2 || r.height < 2) return false
            const st = window.getComputedStyle(el)
            return st.visibility !== 'hidden' && st.display !== 'none'
          })

          for (const el of clickable) {
            const t = norm(el.innerText || el.textContent || '')
            if (labelMatches(t, denom)) {
              el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
              el.focus?.()
              el.click()
              return true
            }
          }

          const idx = CHIP_STRIP_ORDER_LOCAL.findIndex((v) => approxEq(v, denom))
          if (idx < 0) return false

          const numericHits = clickable.filter((el) => {
            const t = norm(el.innerText || '')
            return /^(\d+\.?\d*|\d+)(?:\s*(USD|EUR|UAH|₽|\$|€))?$/i.test(t)
          })
          if (numericHits.length < 3) return false

          const bottom = Math.max(...numericHits.map((e) => e.getBoundingClientRect().bottom))
          const row = numericHits.filter((e) => Math.abs(e.getBoundingClientRect().bottom - bottom) < 100)
          row.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
          if (row.length > idx && row[idx]) {
            row[idx]!.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            row[idx]!.click()
            return true
          }
          return false
        }, amount)
      } catch {
        return false
      }
    }

    if (await tryFrame(this.page.mainFrame())) return true
    for (const fr of this.page.frames()) {
      if (await tryFrame(fr)) return true
    }
    return false
  }

  private async clickChip(amount: number, root: LocatorRoot): Promise<void> {
    const hint = this.findChipHint(amount)
    if (hint && (await this.clickHint(hint))) return

    if (await this.clickChipDom(amount)) return

    const raw = String(amount)
    const strictRx = new RegExp(`^\\s*${escapeRegex(raw)}(?:[.,]0+)?\\s*$`)
    const looseRx = new RegExp(
      `^\\s*${escapeRegex(raw)}(?:[.,]0+)?(?:\\s*(USD|EUR|RUB|UAH|₽|\\$|€|₴))?\\s*$`,
      'i'
    )

    const attempts: Array<() => Promise<void>> = [
      async () => {
        const chip = root.locator('button, [role="button"]').filter({ hasText: strictRx }).first()
        await chip.scrollIntoViewIfNeeded().catch(() => undefined)
        await chip.click({ timeout: CLICK_TIMEOUT_MS, force: true })
      },
      async () => {
        const chip = root.locator('button, [role="button"]').filter({ hasText: looseRx }).first()
        await chip.scrollIntoViewIfNeeded().catch(() => undefined)
        await chip.click({ timeout: CLICK_TIMEOUT_MS, force: true })
      },
      async () => {
        await root
          .getByRole('button', { name: strictRx })
          .first()
          .click({ timeout: CLICK_TIMEOUT_MS, force: true })
      },
      async () => {
        const idx = CHIP_STRIP_ORDER.findIndex((v) => Math.abs(v - amount) < 1e-9)
        if (idx < 0) throw new Error('chip ordinal: amount not in strip')
        const tray = root
          .locator(
            'footer, [class*="Chip"], [class*="chip"], [class*="Footer"], [class*="Bet"], [class*="Panel"]'
          )
          .last()
        const btns = tray.locator('button, [role="button"]')
        const n = await btns.count()
        if (n <= idx) throw new Error('chip ordinal: not enough buttons')
        await btns.nth(idx).scrollIntoViewIfNeeded().catch(() => undefined)
        await btns.nth(idx).click({ timeout: CLICK_TIMEOUT_MS, force: true })
      }
    ]

    let lastErr: unknown
    for (const run of attempts) {
      try {
        await run()
        return
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  private async clickStraightNumber(target: number, root: LocatorRoot): Promise<void> {
    const hint = this.findStraightHint(target)
    if (hint && (await this.clickHint(hint))) return

    if (
      await root.evaluate(([t]) => {
        const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
        const want = new RegExp(`^\\s*${t}\\s*$`)
        const els = Array.from(
          document.querySelectorAll<HTMLElement>('button, [role="button"], div[role="button"], span[role="button"]')
        )
        for (const el of els) {
          const txt = norm(el.innerText || '')
          if (!want.test(txt)) continue
          const r = el.getBoundingClientRect()
          if (r.width < 2 || r.height < 2) continue
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          el.click()
          return true
        }
        return false
      }, [target]).catch(() => false)
    ) {
      return
    }

    const numberRx = new RegExp(`^\\s*${target}\\s*$`)
    const looseNum = new RegExp(`^\\s*${target}(?:[^0-9]|$)`)

    const boardCandidates = root
      .locator('div, section, article')
      .filter({ hasText: BOARD_HINT_RX })
    const board = (await boardCandidates.count()) > 0 ? boardCandidates.first() : root.locator('body')

    const attempts: Array<() => Promise<void>> = [
      async () => {
        const cell = board.locator('button, [role="button"]').filter({ hasText: numberRx }).first()
        await cell.scrollIntoViewIfNeeded().catch(() => undefined)
        await cell.click({ timeout: CLICK_TIMEOUT_MS, force: true })
      },
      async () => {
        const cell = board.locator('div, span').filter({ hasText: numberRx }).first()
        await cell.scrollIntoViewIfNeeded().catch(() => undefined)
        await cell.click({ timeout: CLICK_TIMEOUT_MS, force: true })
      },
      async () => {
        await board.getByRole('button', { name: numberRx }).first().click({ timeout: CLICK_TIMEOUT_MS, force: true })
      },
      async () => {
        const cell = board.locator('button, [role="button"], div, span').filter({ hasText: looseNum }).first()
        await cell.scrollIntoViewIfNeeded().catch(() => undefined)
        await cell.click({ timeout: CLICK_TIMEOUT_MS, force: true })
      }
    ]

    let lastErr: unknown
    for (const run of attempts) {
      try {
        await run()
        return
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  private async confirmBetOn(root: LocatorRoot): Promise<ExecutorResult> {
    try {
      const hint = this.mapping?.confirm
      if (hint && (await this.clickHint(hint))) return { ok: true }

      const clicked = await root.evaluate(() => {
        const labels = /confirm|bet|spin|ставк|подтвер|repeat|повтор|place\s+bet/i
        const els = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], div[role="button"]'))
        for (const el of els) {
          const t = (el.innerText || '').trim()
          if (labels.test(t) && el.offsetParent) {
            el.click()
            return true
          }
        }
        return false
      }).catch(() => false)

      if (clicked) return { ok: true }

      const btn = root
        .locator('button, [role="button"], div, span')
        .filter({ hasText: /confirm|bet|spin|ставк|подтвер|repeat|повтор/i })
        .first()
      if ((await btn.count()) > 0) {
        await btn.scrollIntoViewIfNeeded().catch(() => undefined)
        await btn.click({ timeout: 3500, force: true })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `confirmBet failed: ${firstError(err)}` }
    }
  }

  async placeBet(instructions: BetInstruction[]): Promise<ExecutorResult> {
    try {
      if (!instructions.length) return { ok: true }
      const root = await this.getBestGameFrame()
      const firstAmount = instructions[0]!.amount
      await this.clickChip(firstAmount, root)
      for (const instr of instructions) {
        if (instr.betType !== 'straight' || typeof instr.target !== 'number') {
          return { ok: false, error: `Unsupported instruction for heuristic roulette executor: ${instr.betType}` }
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
      const root = await this.getBestGameFrame()
      const hint = this.mapping?.clear
      if (hint && (await this.clickHint(hint))) return { ok: true }

      const btn = root
        .locator('button, [role="button"], div, span')
        .filter({ hasText: /clear|очист|cancel|отмен/i })
        .first()
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 800, force: true })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `clearBet failed: ${firstError(err)}` }
    }
  }

  async confirmBet(): Promise<ExecutorResult> {
    try {
      const root = await this.getBestGameFrame()
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
