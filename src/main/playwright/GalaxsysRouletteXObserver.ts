import type { TableObservation, TableObserver } from '@modules/parser/types'
import type { Frame, Page } from 'playwright'

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

/** Walk document + open shadow roots; Galaxsys often nests the grid/history inside shadow DOM. */
function collectElementsDeep(root: Element | null): Element[] {
  const out: Element[] = []
  if (!root) return out
  const visit = (el: Element): void => {
    out.push(el)
    if (el.shadowRoot) {
      for (const c of el.shadowRoot.children) visit(c as Element)
    }
    for (const c of el.children) visit(c as Element)
  }
  visit(root)
  return out
}

/** Flat text + labeled snippets for regex (history labels may only appear in one leaf). */
function buildMegaText(doc: Document): string {
  const chunks: string[] = []
  const rootEl = doc.documentElement
  if (!rootEl) return ''
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? '').trim()
      if (t.length) chunks.push(t)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return
    if (el.shadowRoot) walk(el.shadowRoot)
    for (const attr of ['aria-label', 'title', 'alt', 'placeholder']) {
      const a = el.getAttribute(attr)
      if (a && /\d/.test(a)) chunks.push(a)
    }
    for (const attr of ['data-result', 'data-number', 'data-spin', 'data-value', 'data-ball']) {
      const a = el.getAttribute(attr)
      if (a && /^\d{1,2}$/.test(a.trim())) chunks.push(a.trim())
    }
    for (const c of el.childNodes) walk(c)
  }
  walk(rootEl)
  return chunks.join(' ').replace(/\s+/g, ' ')
}

/** Longest run of tokens in 0..36 (space/comma separated) — typical “last spins” strip in UI text. */
function longestConsecutiveRouletteRun(text: string): number[] {
  const tokens = text.split(/[\s,|]+/).filter(Boolean)
  let best: number[] = []
  let cur: number[] = []
  for (const tok of tokens) {
    const n = Number.parseInt(tok.replace(/^[#:]+/, ''), 10)
    if (Number.isInteger(n) && n >= 0 && n <= 36) {
      cur.push(n)
      const uniq = new Set(cur)
      if (cur.length >= 4 && uniq.size <= 14 && cur.length > best.length) best = [...cur]
    } else {
      cur = []
    }
  }
  return best.length >= 4 ? best : []
}

/** Nested Fresh launch: shell frames vs actual game (PartnerApi / ignition URLs). */
function frameGameLikelihood(url: string): number {
  const u = url.toLowerCase()
  if (u.startsWith('about:')) return 0
  if (u.includes('freshcheck') || u.includes('store.html')) return 2
  if (u.includes('fresh.casino')) return 6
  if (
    /launch|partner|ignition|game_url|galaxsys|roulett|sslaunch|round-\d|\/game\//i.test(u)
  )
    return 14
  return 5
}

/** Prefer snippets near history / results keywords (nested launcher frames). */
function extractNearKeywords(full: string): string {
  const windows: string[] = []
  const lower = full.toLowerCase()
  const keys = [
    'истори',
    'history',
    'результат',
    'result',
    'recent',
    'последн',
    'previous',
    'спин',
    'spin',
    'winning',
    'выпало'
  ]
  for (const k of keys) {
    let i = 0
    while ((i = lower.indexOf(k, i)) !== -1) {
      const start = Math.max(0, i - 40)
      const end = Math.min(full.length, i + 220)
      windows.push(full.slice(start, end))
      i += k.length
    }
  }
  return windows.join(' ')
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
  scanText: string
  balanceText: string
  balanceSourceLine: string
  tableLabel: string | null
  explicitResults: number[]
  stripNumbers: number[]
  roundId: string | null
  /** Extra number sequences from history / results UI */
  extraNumberRuns: number[]
  /** From deep text run heuristic */
  deepStripNumbers: number[]
  /** History modal column «10 Черный» — document order top = newest round */
  gameColumnNumbers: number[]
  /** Lone 0–36 in a small element whose ancestors suggest «last result» UI */
  singleResultHits: number[]
}

function emptySnap(): Snap {
  return {
    historyText: '',
    bodyText: '',
    scanText: '',
    balanceText: '',
    balanceSourceLine: '',
    tableLabel: null,
    explicitResults: [],
    stripNumbers: [],
    roundId: null,
    extraNumberRuns: [],
    deepStripNumbers: [],
    gameColumnNumbers: [],
    singleResultHits: []
  }
}

/**
 * Snapshot roulette-ish numbers from one document (main page or iframe).
 * Never throws — otherwise Playwright drops the whole frame from merge → `no-data`.
 */
function snapshotFromDocument(): Snap {
  try {
    return snapshotFromDocumentUnsafe()
  } catch {
    return emptySnap()
  }
}

function snapshotFromDocumentUnsafe(): Snap {
  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const root = document.documentElement
  if (!root || !document.body) return emptySnap()

  const bodyText = (document.body.innerText ?? '').replace(/\s+/g, ' ')
  const megaText = buildMegaText(document)
  const keywordBlob = extractNearKeywords(`${megaText} ${bodyText}`)
  const scanText = `${bodyText} ${megaText} ${keywordBlob}`.replace(/\s+/g, ' ')
  const all = collectElementsDeep(root).filter((el) => {
    const tag = el.tagName.toLowerCase()
    return tag !== 'script' && tag !== 'style' && tag !== 'noscript'
  })

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
    while ((m = re.exec(scanText)) !== null) {
      const fragment = m[0]!.trim()
      if (fragment.length > 3 && fragment.length < 100) {
        balanceLines.push({ t: fragment, score: balanceCandidateScore(fragment) + 2 })
      }
    }
  }
  balanceLines.sort((a, b) => b.score - a.score || b.t.length - a.t.length)
  if (balanceLines.length) balanceSourceLine = balanceLines[0]!.t

  const explicitResults: number[] = []
  const gameColumnNumbers: number[] = []
  const colorPairRe =
    /\b(\d{1,2})\s+(Черный|Красный|Зеленый|Чёрный|Black|Red|Green)\b/gi
  let cm: RegExpExecArray | null
  while ((cm = colorPairRe.exec(scanText)) !== null) {
    const n = Number.parseInt(cm[1]!, 10)
    if (n >= 0 && n <= 36) gameColumnNumbers.push(n)
  }

  for (const re of [
    /(?:Результат\s*игры|Game\s*result)\s*[:\s]*(\d{1,2})\b/gi,
    /(?:Результат|Result)\s*\([^)]*\)\s*[:\s]*(\d{1,2})\b/gi,
    /(?:Результат|Result)\s*[:\s]*(\d{1,2})\b/gi,
    /(?:Выпало|Winning|Winner|Выпал)\s*[:\s]*(\d{1,2})\b/gi,
    /(?:Last\s+number|Последний\s+номер)\s*[:\s]*(\d{1,2})\b/gi
  ]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(scanText)) !== null) {
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
    const stripMatch = scanText.match(re)
    if (stripMatch?.[1]) {
      stripNumbers = parseRouletteInts(stripMatch[1])
      if (stripNumbers.length) break
    }
  }

  const runKw = longestConsecutiveRouletteRun(keywordBlob)
  const runWide = longestConsecutiveRouletteRun(scanText)
  let deepStripNumbers: number[] = []
  if (runKw.length >= 4) deepStripNumbers = runKw
  else if (runWide.length >= 4 && new Set(runWide).size <= 14) deepStripNumbers = runWide

  if (!stripNumbers.length && deepStripNumbers.length) stripNumbers = deepStripNumbers

  /** Modal «История»: table lists newest round first — keep order, do not reverse later */
  if (!stripNumbers.length && gameColumnNumbers.length >= 1) stripNumbers = [...gameColumnNumbers]

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
    scanText.match(/(?:ID\s*раунда|Round\s*(?:ID|id)?)\s*[:\s#]*(\d+)/iu) ??
    scanText.match(/(?:Ticket|Билет|Game\s*ID)\s*(?:ID|id)?\s*[:\s#]*(\d+)/iu)
  if (rid?.[1]) roundId = rid[1]

  const singleResultHits: number[] = []
  const clsPlusAncestors = (el: Element): string => {
    let s = clsId(el)
    let p: Element | null = el.parentElement
    for (let d = 0; d < 4 && p; d += 1, p = p.parentElement) {
      const hc = (p as HTMLElement).className
      const cl = typeof hc === 'string' ? hc : ''
      s += ` ${cl} ${p.id ?? ''}`
    }
    return s
  }
  for (const el of all) {
    const raw = text(el)
    const onlyNum = raw.match(/^\s*(\d{1,2})\s*$/)
    if (!onlyNum) continue
    const n = Number.parseInt(onlyNum[1]!, 10)
    if (!Number.isInteger(n) || n < 0 || n > 36) continue
    if (raw.length > 4) continue
    const ctx = clsPlusAncestors(el).toLowerCase()
    /** Avoid matching every «cell» on the felt: require result/history/racetrack-adjacent hints, not generic `number`. */
    if (
      /result|winner|last[-_]?win|last[-_]?spin|ball|outcome|current|previous|последн|выпал|roulette|stat(ist)?|history|colour|color|hot|cold|recent|wheel|sector|выпад|раунд|round(?!-id)/i.test(
        ctx
      )
    ) {
      singleResultHits.push(n)
    }
  }

  return {
    historyText,
    bodyText,
    scanText,
    balanceText: balanceSourceLine,
    balanceSourceLine,
    tableLabel: (document.title || '').trim() || null,
    explicitResults,
    stripNumbers,
    roundId,
    extraNumberRuns,
    deepStripNumbers,
    gameColumnNumbers,
    singleResultHits
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

  if (snap.gameColumnNumbers.length >= 1) {
    recent = mergeDedupeNewestFirst(snap.gameColumnNumbers, 16)
  } else if (strip.length) {
    recent = mergeDedupeNewestFirst([...strip].reverse(), 16)
  } else if (fromExtras.length >= 4) {
    recent = mergeDedupeNewestFirst([...fromExtras].reverse(), 16)
  } else if (explicit.length) {
    /** Labeled «Результат» lines in modal: first match in reading order ≈ newest row */
    const anchor = explicit[0]!
    recent = mergeDedupeNewestFirst([anchor, ...fromHistory], 16)
  } else if (fromHistory.length) {
    recent = mergeDedupeNewestFirst(fromHistory, 16)
  } else if (snap.singleResultHits.length >= 1) {
    recent = mergeDedupeNewestFirst(snap.singleResultHits, 16)
  }

  const lower = snap.scanText.toLowerCase()
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
  if (snap.gameColumnNumbers.length)
    rawParts.push(`gameCol:${snap.gameColumnNumbers.slice(0, 20).join(',')}`)
  if (snap.singleResultHits.length)
    rawParts.push(`single:${snap.singleResultHits.slice(0, 12).join(',')}`)
  if (snap.deepStripNumbers.length && strip.join(',') !== snap.deepStripNumbers.join(','))
    rawParts.push(`deepStrip:${snap.deepStripNumbers.join(',')}`)
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

/**
 * Best-effort observer for Fresh Casino / Galaxsys Roulette X.
 * Tries main document + same-origin iframes; merges balance from one frame with spins from another.
 */
export class GalaxsysRouletteXObserver implements TableObserver {
  readonly id = 'galaxsys-roulettex'

  constructor(private readonly page: Page) {}

  /** Longest block of 0–36 tokens in one element (recent-results strip above the felt). */
  private async scrapeHorizontalStripFromFrame(frame: Frame): Promise<number[]> {
    return frame
      .evaluate(() => {
        const tok = (text: string): number[] => {
          const out: number[] = []
          for (const part of text.split(/[^0-9]+/)) {
            if (!part) continue
            const n = Number.parseInt(part, 10)
            if (n >= 0 && n <= 36) out.push(n)
          }
          return out
        }
        const visit = (el: Element, fn: (e: Element) => void): void => {
          fn(el)
          const sr = (el as HTMLElement).shadowRoot
          if (sr) {
            for (const c of sr.children) visit(c as Element, fn)
          }
          for (const c of el.children) visit(c as Element, fn)
        }
        let best: number[] = []
        if (!document.documentElement) return []
        visit(document.documentElement, (el) => {
          const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (t.length < 12 || t.length > 600) return
          const nums = tok(t)
          if (nums.length < 4) return
          const uniq = new Set(nums)
          if (uniq.size < 5 || uniq.size > 24) return
          if (nums.length > best.length) best = nums
        })
        return best.slice(0, 28)
      })
      .catch(() => [])
  }

  /**
   * When evaluate-in-frame misses (opaque iframe / transient errors), read visible text via Playwright selectors.
   * Scans every frame: «10 Черный», horizontal number strips, balance «31 USD».
   */
  private async scrapeViaLocators(): Promise<{ recentNumbers: number[]; balance: number | null }> {
    const colorRx =
      /^\s*(\d{1,2})\s+(Черный|Красный|Зеленый|Чёрный|Black|Red|Green)\b/i

    let bestStrip: number[] = []
    const fromColors: number[] = []

    const frames = this.page.frames().slice(0, 24)
    for (const frame of frames) {
      try {
        const strip = await this.scrapeHorizontalStripFromFrame(frame)
        if (strip.length > bestStrip.length) bestStrip = strip
      } catch {
        /* ignore */
      }

      try {
        const loc = frame
          .locator('td, [role="gridcell"], [role="cell"], div, span')
          .filter({ hasText: colorRx })
        const n = await loc.count()
        const seen = new Set<string>()
        for (let i = 0; i < Math.min(n, 64); i++) {
          const txt = (await loc.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
          if (txt.length < 3 || seen.has(txt)) continue
          seen.add(txt)
          const m = txt.match(colorRx)
          if (m) {
            const v = Number.parseInt(m[1]!, 10)
            if (v >= 0 && v <= 36) fromColors.push(v)
          }
        }
      } catch {
        /* ignore */
      }
    }

    let recentNumbers: number[] = []
    if (fromColors.length) {
      recentNumbers = mergeDedupeNewestFirst(fromColors, 16)
    } else if (bestStrip.length >= 4) {
      recentNumbers = mergeDedupeNewestFirst(bestStrip, 16)
    }

    let balance: number | null = null
    for (const frame of frames) {
      try {
        const balEl = frame
          .getByText(/\b\d{1,8}(?:[.,]\d+)?\s*(USD|EUR|RUB|UAH|₽|\$|€|₴)\b/i)
          .first()
        const bt = await balEl.innerText({ timeout: 600 }).catch(() => '')
        const p = parseFirstNumber(bt)
        if (p != null) {
          balance = p
          break
        }
      } catch {
        /* ignore */
      }
    }

    return {
      recentNumbers,
      balance
    }
  }

  async observe(): Promise<TableObservation> {
    const collected: { obs: TableObservation; url: string }[] = []

    for (const frame of this.page.frames()) {
      try {
        let url = ''
        try {
          url = frame.url()
        } catch {
          url = ''
        }
        const snap = await frame.evaluate(snapshotFromDocument)
        const obs = buildObservationFromSnap(snap)
        collected.push({
          obs: {
            ...obs,
            rawNote: `${obs.rawNote}|frame:${url.slice(0, 140)}`
          },
          url
        })
      } catch {
        /* cross-origin iframe or detached — Playwright cannot evaluate inside */
      }
    }

    if (!collected.length) {
      const fb = await this.scrapeViaLocators()
      if (fb.recentNumbers.length || fb.balance != null) {
        return {
          recentNumbers: fb.recentNumbers,
          bettingOpen: null,
          timerSeconds: null,
          balance: fb.balance,
          tableLabel: null,
          roundId: null,
          rawNote: `galaxsys-heuristic|locator-only|recent:${fb.recentNumbers.join(',')}|balance:${fb.balance ?? 'null'}`
        }
      }
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

    const ranked = [...collected].sort((a, b) => {
      const diff = b.obs.recentNumbers.length - a.obs.recentNumbers.length
      if (diff !== 0) return diff
      return frameGameLikelihood(b.url) - frameGameLikelihood(a.url)
    })

    let recentNumbers = ranked[0]!.obs.recentNumbers
    for (const { obs } of ranked) {
      if (obs.recentNumbers.length > recentNumbers.length) recentNumbers = obs.recentNumbers
    }

    let balance: number | null = null
    for (const { obs } of ranked) {
      if (obs.balance != null) {
        balance = obs.balance
        break
      }
    }

    /** Already sorted by spin count then launcher likelihood — first row is best shell when empty. */
    const primary =
      ranked.find((r) => r.obs.recentNumbers.length > 0) ?? ranked[0]!

    let roundId: string | null = primary.obs.roundId ?? null
    if (!roundId) {
      for (const { obs } of ranked) {
        if (obs.roundId != null) {
          roundId = obs.roundId
          break
        }
      }
    }

    let bettingOpen: boolean | null = null
    for (const { obs } of ranked) {
      if (obs.bettingOpen !== null && obs.bettingOpen !== undefined) {
        bettingOpen = obs.bettingOpen
        break
      }
    }

    let rawNote = `${primary.obs.rawNote}|frames:${collected.length}`

    if (recentNumbers.length === 0 || balance == null) {
      const fb = await this.scrapeViaLocators()
      if (fb.recentNumbers.length > recentNumbers.length) {
        recentNumbers = fb.recentNumbers
      }
      if (balance == null && fb.balance != null) {
        balance = fb.balance
      }
      if (fb.recentNumbers.length || fb.balance != null) {
        rawNote = `${rawNote}|locatorFallback`
      }
    }

    return {
      recentNumbers,
      bettingOpen,
      timerSeconds: null,
      balance,
      tableLabel: primary.obs.tableLabel,
      roundId,
      rawNote
    }
  }
}
