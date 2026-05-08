import type { TableObservation, TableObserver } from '@modules/parser/types'
import type { Page } from 'playwright'

export type DomObserverSelectors = {
  /** CSS selector; innerText parsed as comma-separated integers */
  recentNumbers?: string
  balance?: string
}

/**
 * Minimal DOM observer: selectors are optional; returns partial observation on failure.
 * Intended as a template for site-specific adapters (user-maintained selectors).
 */
export class GenericDomObserver implements TableObserver {
  readonly id = 'generic-dom'

  constructor(
    private readonly page: Page,
    private readonly selectors: DomObserverSelectors
  ) {}

  async observe(): Promise<TableObservation> {
    const recentNumbers: number[] = []
    let balance: number | null = null
    try {
      if (this.selectors.recentNumbers) {
        const txt = await this.page.locator(this.selectors.recentNumbers).first().innerText().catch(() => '')
        for (const part of txt.split(/[\s,|]+/).map((s) => s.trim()).filter(Boolean)) {
          const n = Number.parseInt(part, 10)
          if (Number.isInteger(n) && n >= 0 && n <= 36) recentNumbers.push(n)
        }
      }
      if (this.selectors.balance) {
        const btxt = await this.page.locator(this.selectors.balance).first().innerText().catch(() => '')
        const cleaned = btxt.replace(/[^0-9.,-]/g, '').replace(',', '')
        const v = Number.parseFloat(cleaned)
        balance = Number.isFinite(v) ? v : null
      }
    } catch {
      /* return partial */
    }
    return {
      recentNumbers,
      bettingOpen: null,
      timerSeconds: null,
      balance,
      tableLabel: null,
      rawNote: 'generic-dom'
    }
  }
}
