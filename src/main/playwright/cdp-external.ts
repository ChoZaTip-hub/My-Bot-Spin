import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { externalCdpEndpoint } from '../cdp-config'
import type { Logger } from '../logger'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function chromeExecutableCandidates(): string[] {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
    ]
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? ''
    return [
      join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ]
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']
}

export function resolveChromeExecutable(): string | null {
  for (const p of chromeExecutableCandidates()) {
    try {
      accessSync(p, constants.X_OK)
      return p
    } catch {
      /* try next */
    }
  }
  return null
}

async function waitForCdpHttp(port: string, deadlineMs: number): Promise<void> {
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return
    } catch {
      /* retry */
    }
    await sleep(200)
  }
  throw new Error(`CDP endpoint not ready on ${base} within ${deadlineMs}ms`)
}

export type ExternalCdpHandle = {
  browser: Browser
  page: Page
  /** Set when we spawned Chrome; may be null if reusing an existing debug session. */
  chromeChild: ChildProcess | null
}

function hostFromUrl(startUrl: string): string {
  try {
    return new URL(startUrl).hostname
  } catch {
    return 'fresh.casino'
  }
}

async function pickCasinoPage(browser: Browser, host: string, deadlineMs: number): Promise<Page | null> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) {
        let u = ''
        try {
          u = p.url()
        } catch {
          continue
        }
        if (!u || u === 'about:blank') continue
        if (u.startsWith('devtools://')) continue
        if (/localhost|127\.0\.0\.1/.test(u) && !u.includes(host)) continue
        if (u.includes(host) || /fresh\.casino|galaxsys|galaxys/i.test(u)) {
          await p.waitForLoadState('domcontentloaded').catch(() => undefined)
          return p
        }
      }
    }
    await sleep(120)
  }
  return null
}

/**
 * Attach Playwright to a Chromium browser on a CDP port. Spawns Chrome with
 * `--remote-debugging-port` when nothing is listening yet.
 */
export async function connectExternalChromeCdp(params: {
  port: string
  profileDir: string
  startUrl?: string
  logger: Logger
  quietMs: number
}): Promise<ExternalCdpHandle> {
  const { chromium } = await import('playwright')
  const endpoint = `http://127.0.0.1:${params.port}`
  let chromeChild: ChildProcess | null = null

  let browser: Browser | null = null
  try {
    browser = await chromium.connectOverCDP(endpoint)
    params.logger.log('info', 'Reused existing Chrome CDP session', { endpoint })
  } catch {
    browser = null
  }

  if (!browser) {
    const exe = resolveChromeExecutable()
    if (!exe) {
      throw new Error(
        'Google Chrome not found. Install Chrome or set RSA_TABLE_BROWSER=webkit, or use embedded table.'
      )
    }
    const args = [
      `--remote-debugging-port=${params.port}`,
      `--user-data-dir=${params.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled'
    ]
    if (params.startUrl?.startsWith('http')) {
      args.push(params.startUrl)
    }
    params.logger.log('info', 'Spawning Chrome with CDP', { endpoint, exe })
    chromeChild = spawn(exe, args, { detached: true, stdio: 'ignore' })
    chromeChild.unref()
    await waitForCdpHttp(params.port, 45_000)
    browser = await chromium.connectOverCDP(endpoint)
  }

  if (params.quietMs > 0) {
    params.logger.log('info', 'CDP Chrome: quiet period before parser attach', { quietMs: params.quietMs })
    await sleep(params.quietMs)
  }

  const host = params.startUrl ? hostFromUrl(params.startUrl) : 'fresh.casino'
  let page = await pickCasinoPage(browser, host, 12_000)

  if (!page && params.startUrl?.startsWith('http')) {
    const ctx = browser.contexts()[0] ?? (await browser.newContext())
    page = await ctx.newPage()
    await page.goto(params.startUrl, { waitUntil: 'domcontentloaded' })
    if (params.quietMs > 0) await sleep(Math.min(params.quietMs, 8000))
  }

  if (!page) {
    page = browser.contexts()[0]?.pages()[0] ?? null
  }
  if (!page) {
    await browser.close().catch(() => undefined)
    throw new Error('CDP Chrome: no page available after connect')
  }

  return { browser, page, chromeChild }
}

export function defaultExternalCdpQuietMs(): number {
  const raw = process.env.RSA_EXTERNAL_CDP_DELAY_MS ?? process.env.RSA_EMBEDDED_CDP_DELAY_MS
  if (raw === '0') return 0
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 0) return Math.min(120_000, n)
  }
  return 4500
}

export { externalCdpEndpoint }
