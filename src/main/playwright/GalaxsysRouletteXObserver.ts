import type { TableObservation, TableObserver } from '@modules/parser/types'
import type { Page } from 'playwright'

function parseFirstNumber(text: string): number | null {
  const compact = text.replace(/(\d)\s+(?=\d)/g, '$1')
  const m = compact.match(/-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  let raw = m[0]!
  if (raw.includes(',') && raw.includes('.')) {
    raw = raw.replace(/\./g, '').replace(',', '.')
  } else if (raw.includes(',') && !raw.includes('.')) {
    const parts = raw.split(',')
    if (parts.length === 2 && parts[1]!.length <= 2) raw = `${parts[0]}.${parts[1]}`
    else raw = raw.replace(/,/g, '')
  }
  const n = Number.parseFloat(raw)
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

function mergeDedupeNewestFirst(nums: number[], limit: number): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const n of nums) {
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
    if (out.length >= limit) break
  }
  return out
}

/** Strongest signal = currency symbol / code near a plausible amount */
function balanceCandidateScore(t: string): number {
  let s = 0
  if (/(₽|\$|€|₴|₸|usd|eur|rub|uah|kzt|fun|казах|тенге)/i.test(t)) s += 4
  if (/(баланс|balance|wallet|кошел|кредит|credit|сч[ёе]т|funds|money)/i.test(t)) s += 3
  if (/\d\s*\d/.test(t) || /\d[.,]\d{2}\b/.test(t)) s += 1
  if (t.length > 8 && t.length < 90) s += 1
  return s
}

type Snap = {
  historyText: string
  bodyText: string
  balanceText: string
  balanceSourceLine: string
  tableLabel: string | null
  explicitResults: number[]
  stripNumbers: number[]
  roundId: string | null
  /** Extra number sequences from history / results UI */
  extraNumberRuns: number[]
}

/**
 * Snapshot roulette-ish numbers from one document (main page or iframe).
 */
function snapshotFromDocument(): Snap {
  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const bodyText = (document.body?.innerText ?? '').replace(/\s+/g, ' ')
  const all = Array.from(document.querySelectorAll('div, section, article, span, li, td, p, header, footer'))

  const clsId = (el: Element): string => {
    const c = (el as HTMLElement).className
    const cl = typeof c === 'string' ? c : ''
    return `${cl} ${el.id ?? ''}`.toLowerCase()
  }

  const historyContainers = all.filter((el) => {
    const t = text(el).toLowerCase()
    const ci = clsId(el)
    return (
      t.includes('история') ||
      t.includes('history') ||
      /history|past\s*spins|recent|results|roulette|спин|последн/i.test(ci)
    )
  })

  let historyText =
    historyContainers.map((el) => text(el)).find((t) => /\b\d{1,2}\b/.test(t)) ?? ''

  const deepestHistory = historyContainers
    .map((el) => text(el))
    .sort((a, b) => b.length - a.length)[0]
  if (deepestHistory && deepestHistory.length > historyText.length) historyText = deepestHistory

  const balanceKeywords =
    /(₽|\$|€|₴|₸|usd|eur|rub|uah|kzt|баланс|balance|wallet|кошел|кредит|credit|сч[ёе]т|funds|cash|money|монет|coins)/i

  const balanceLines: { t: string; score: number }[] = []
  for (const el of all) {
    const t = text(el)
    if (t.length < 3 || t.length > 140) continue
    if (!/\d/.test(t)) continue
    if (!balanceKeywords.test(t)) continue
    const score = balanceCandidateScore(t)
    if (score >= 4) balanceLines.push({ t, score })
  }
  balanceLines.sort((a, b) => b.score - a.score || b.t.length - a.t.length)

  let balanceSourceLine = balanceLines[0]?.t ?? ''

  const labelMoneyRes = [
    /(?:Баланс|Balance|Wallet|Кошел(?:ёе|е)к|Сч[ёе]т)\s*[:\s]+([₽$€₴₸]?\s*[\d\s.,]+)/gi,
    /([₽$€₴₸]\s*[\d][\d\s.,]{2,40})/g
  ]
  for (const re of labelMoneyRes) {
    let m: RegExpExecArray | null
    while ((m = re.exec(bodyText)) !== null) {
      const fragment = m[0]!.trim()
      if (fragment.length > 3 && fragment.length < 100) {
        balanceLines.push({ t: fragment, score: balanceCandidateScore(fragment) + 2 })
      }
    }
  }
  balanceLines.sort((a, b) => b.score - a.score || b.t.length - a.t.length)
  if (balanceLines.length) balanceSourceLine = balanceLines[0]!.t

  const explicitResults: number[] = []
  for (const re of [
    /(?:Результат|Result)\s*[:\s]*(\d{1,2})\b/gi,
    /(?:Выпало|Winning|Winner|Выпал)\s*[:\s]*(\d{1,2})\b/gi,
    /(?:Last\s+number|Последний\s+номер)\s*[:\s]*(\d{1,2})\b/gi
  ]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(bodyText)) !== null) {
      const n = Number.parseInt(m[1]!, 10)
      if (n >= 0 && n <= 36) explicitResults.push(n)
    }
  }

  const stripPatterns: RegExp[] = [
    /(?:Результаты|Recent\s+results|Последние|Последние\s+спины)\s*[:\s]*([\d\s,.|]+)/i,
    /(?:Last\s+spins|История\s+спинов)\s*[:\s]*([\d\s,.|]+)/i,
    /(?:Спины|Spins)\s*[:\s]*([\d\s,.|]+)/i,
    /(?:Previous\s+results|Предыдущие)\s*[:\s]*([\d\s,.|]+)/i
  ]

  let stripNumbers: number[] = []
  for (const re of stripPatterns) {
    const stripMatch = bodyText.match(re)
    if (stripMatch?.[1]) {
      stripNumbers = parseRouletteInts(stripMatch[1])
      if (stripNumbers.length) break
    }
  }

  /** Compact horizontal “last spins” rows (avoid full betting grid: too many distinct pockets). */
  const extraNumberRuns: number[] = []
  for (const el of all) {
    const t = text(el)
    if (t.length < 6 || t.length > 220) continue
    const nums = parseRouletteInts(t)
    const uniq = new Set(nums)
    if (uniq.size < 4 || uniq.size > 14 || nums.length > 22) continue
    const ci = clsId(el)
    const looksLikeStrip =
      /result|history|recent|spin|outcome|stat|лист|ряд|strip|ball|win|previous/i.test(ci) ||
      /^\s*[\d\s,.|]+\s*$/i.test(t)
    if (!looksLikeStrip) continue
    for (const n of nums) extraNumberRuns.push(n)
  }

  let roundId: string | null = null
  const rid =
    bodyText.match(/(?:ID\s*раунда|Round\s*(?:ID|id)?)\s*[:\s#]*(\d+)/iu) ??
    bodyText.match(/(?:Ticket|Билет|Game\s*ID)\s*(?:ID|id)?\s*[:\s#]*(\d+)/iu)
  if (rid?.[1]) roundId = rid[1]

  return {
    historyText,
    bodyText,
    balanceText: balanceSourceLine,
    balanceSourceLine,
    tableLabel: (document.title || '').trim() || null,
    explicitResults,
    stripNumbers,
    roundId,
    extraNumberRuns
  }
}

function buildObservationFromSnap(snap: Snap): TableObservation {
  const fromHistory = parseRouletteInts(snap.historyText)
  let recent: number[] = []

  const strip = snap.stripNumbers.length ? snap.stripNumbers : []
  const fromExtras = snap.extraNumberRuns.length
    ? mergeDedupeNewestFirst(snap.extraNumberRuns, 24)
    : []
  const explicit = snap.explicitResults

  if (strip.length) {
    recent = mergeDedupeNewestFirst([...strip].reverse(), 16)
  } else if (fromExtras.length >= 4) {
    recent = mergeDedupeNewestFirst([...fromExtras].reverse(), 16)
  } else if (explicit.length) {
    const last = explicit[explicit.length - 1]!
    recent = mergeDedupeNewestFirst([last, ...fromHistory], 16)
  } else if (fromHistory.length) {
    recent = mergeDedupeNewestFirst(fromHistory, 16)
  }

  const lower = snap.bodyText.toLowerCase()
  let bettingOpen: boolean | null = null
  if (/(ставки закрыты|no more bets|bets closed)/i.test(lower)) bettingOpen = false
  if (/(делайте ставки|place your bets|bets open|ставки принимаются)/i.test(lower)) bettingOpen = true
  const balance = parseFirstNumber(snap.balanceText)

  const rawParts: string[] = ['galaxsys-heuristic']
  if (snap.roundId) rawParts.push(`rid:${snap.roundId}`)
  if (snap.balanceSourceLine)
    rawParts.push(`balanceLine:${snap.balanceSourceLine.slice(0, 120)}`)
  if (balance != null) rawParts.push(`balanceParsed:${balance}`)
  if (strip.length) rawParts.push(`strip:${strip.join(',')}`)
  if (fromExtras.length) rawParts.push(`runs:${mergeDedupeNewestFirst(fromExtras, 16).join(',')}`)
  if (explicit.length) rawParts.push(`result:${explicit.join(',')}`)
  if (fromHistory.length) rawParts.push(`hist:${fromHistory.join(',')}`)
  if (recent.length) rawParts.push(`recent:${recent.join(',')}`)

  return {
    recentNumbers: recent,
    bettingOpen,
    timerSeconds: null,
    balance,
    tableLabel: snap.tableLabel,
    roundId: snap.roundId,
    rawNote: rawParts.join('|')
  }
}

function mergeObservations(a: TableObservation, b: TableObservation): TableObservation {
  const recent =
    b.recentNumbers.length > a.recentNumbers.length ? b.recentNumbers : a.recentNumbers
  const balance = a.balance ?? b.balance
  const roundId = a.roundId ?? b.roundId
  const rawNote = [a.rawNote, b.rawNote].filter(Boolean).join('||')
  return {
    recentNumbers: recent,
    bettingOpen: a.bettingOpen ?? b.bettingOpen,
    timerSeconds: null,
    balance,
    tableLabel: a.tableLabel ?? b.tableLabel,
    roundId,
    rawNote
  }
}

/**
 * Best-effort observer for Fresh Casino / Galaxsys Roulette X.
 * Tries main document + same-origin iframes; merges balance from one frame with spins from another.
 */
export class GalaxsysRouletteXObserver implements TableObserver {
  readonly id = 'galaxsys-roulettex'

  constructor(private readonly page: Page) {}

  async observe(): Promise<TableObservation> {
    const collected: TableObservation[] = []

    for (const frame of this.page.frames()) {
      try {
        const snap = await frame.evaluate(snapshotFromDocument)
        const obs = buildObservationFromSnap(snap)
        let frameHint = ''
        try {
          frameHint = frame.url().slice(0, 120)
        } catch {
          frameHint = 'unknown-frame'
        }
        collected.push({
          ...obs,
          rawNote: `${obs.rawNote}|frame:${frameHint}`
        })
      } catch {
        /* cross-origin iframe or detached */
      }
    }

    if (!collected.length) {
      return {
        recentNumbers: [],
        bettingOpen: null,
        timerSeconds: null,
        balance: null,
        tableLabel: null,
        roundId: null,
        rawNote: 'galaxsys-heuristic|no-data'
      }
    }

    let merged = collected[0]!
    for (let i = 1; i < collected.length; i++) {
      merged = mergeObservations(merged, collected[i]!)
    }

    /** Prefer the frame with the richest recent list as primary rawNote tail */
    const richest = collected.reduce((best, cur) =>
      cur.recentNumbers.length > best.recentNumbers.length ? cur : best
    )
    if (richest.recentNumbers.length > merged.recentNumbers.length) {
      merged = { ...merged, recentNumbers: richest.recentNumbers }
    }

    const withBalance = collected.find((o) => o.balance != null)
    if (withBalance) {
      merged = { ...merged, balance: withBalance.balance, roundId: merged.roundId ?? withBalance.roundId }
    }

    merged.rawNote = `${merged.rawNote}|frames:${collected.length}`
    return merged
  }
}
