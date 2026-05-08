import type { TableObservation, TableObserver } from '@modules/parser/types'
import type { Page } from 'playwright'

function parseFirstNumber(text: string): number | null {
  const m = text.match(/-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  const n = Number.parseFloat(m[0]!.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function parseRouletteInts(text: string): number[] {
  const out: number[] = []
  for (const token of text.split(/[^0-9]+/g)) {
    if (!token) continue
    const n = Number.parseInt(token, 10)
    if (Number.isInteger(n) && n >= 0 && n <= 36) out.push(n)
  }
  return out
}

/**
 * Best-effort observer for Fresh Casino / Galaxsys Roulette X.
 * Uses a "history panel" heuristic and may require tuning after site updates.
 */
export class GalaxsysRouletteXObserver implements TableObserver {
  readonly id = 'galaxsys-roulettex'

  constructor(private readonly page: Page) {}

  async observe(): Promise<TableObservation> {
    const snap = await this.page.evaluate(() => {
      const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
      const all = Array.from(document.querySelectorAll('div, section, article, span'))
      const historyContainers = all.filter((el) => {
        const t = text(el).toLowerCase()
        return t.includes('история') || t.includes('history')
      })
      const historyText = historyContainers.map((el) => text(el)).find((t) => /\b\d{1,2}\b/.test(t)) ?? ''
      const bodyText = text(document.body)

      const balanceCandidates = all
        .map((el) => text(el))
        .filter((t) => /(usd|eur|rub|uah|\$|€|₽|₴)/i.test(t) && /\d/.test(t))

      return {
        historyText,
        bodyText,
        balanceText: balanceCandidates[0] ?? '',
        tableLabel: (document.title || '').trim() || null
      }
    })

    const numbers = parseRouletteInts(snap.historyText).slice(0, 12)
    const lower = snap.bodyText.toLowerCase()
    let bettingOpen: boolean | null = null
    if (/(ставки закрыты|no more bets|bets closed)/i.test(lower)) bettingOpen = false
    if (/(делайте ставки|place your bets|bets open|ставки принимаются)/i.test(lower)) bettingOpen = true
    const balance = parseFirstNumber(snap.balanceText)

    return {
      recentNumbers: numbers,
      bettingOpen,
      timerSeconds: null,
      balance,
      tableLabel: snap.tableLabel,
      rawNote: 'galaxsys-heuristic'
    }
  }
}
