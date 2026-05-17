import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Browser, BrowserContext, Page } from 'playwright'
import { ELECTRON_CDP_PORT, EXTERNAL_CDP_PORT, electronCdpEndpoint } from '../cdp-config'
import type { TableEmbedManager } from '../table-embed'
import type { Logger } from '../logger'
import type { TableBrowserMode } from '../table-browser-mode'
import { TABLE_MAIN_WORLD_MITIGATION } from '../automation-mitigation'
import {
  connectExternalChromeCdp,
  defaultExternalCdpQuietMs
} from './cdp-external'
import { openUrlInSafariApp } from './safari-open'
/** Subfolder under Electron userData — persistent Chrome profile for CDP launch. */
const CDP_CHROME_PROFILE_DIR = 'chrome-cdp-profile'

/** Legacy Playwright persistent context profile. */
const PLAYWRIGHT_PROFILE_DIR = 'playwright-chromium-profile'

const PLAYWRIGHT_TABLE_CONTEXT_OPTS = {
  headless: false,
  viewport: { width: 1280, height: 800 },
  locale: 'ru-RU' as const,
  chromiumSandbox: process.env.RSA_PLAYWRIGHT_NO_SANDBOX !== '1',
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled']
}

export type BrowserHostOptions = {
  getMainWindow: () => BrowserWindow | null
  tableEmbed: TableEmbedManager | null
  useEmbeddedTable: boolean
}

export type BrowserLaunchOptions = {
  useEmbeddedTable?: boolean
  tableBrowser?: TableBrowserMode
}

function hostFromUrl(startUrl: string): string {
  try {
    return new URL(startUrl).hostname
  } catch {
    return 'fresh.casino'
  }
}

function embeddedCdpQuietMs(): number {
  const raw = process.env.RSA_EMBEDDED_CDP_DELAY_MS
  if (raw === '0') return 0
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 0) return Math.min(120_000, n)
  }
  return 4500
}

export class BrowserHost {
  private context: BrowserContext | null = null
  private page: Page | null = null
  /** CDP-connected browser (embedded Electron or external Chrome). */
  private cdpBrowser: Browser | null = null
  private webkitBrowser: Browser | null = null

  constructor(
    private readonly logger: Logger,
    private readonly userDataDir: string,
    private readonly opts: BrowserHostOptions
  ) {}

  getPage(): Page | null {
    return this.page
  }

  async launch(startUrl?: string, launchOpts?: BrowserLaunchOptions): Promise<void> {
    const win = this.opts.getMainWindow()
    const mode: TableBrowserMode =
      launchOpts?.tableBrowser ??
      (launchOpts?.useEmbeddedTable === true || this.opts.useEmbeddedTable ? 'embedded' : 'cdp-chrome')

    const embed =
      mode === 'embedded' &&
      Boolean(startUrl?.startsWith('http')) &&
      Boolean(this.opts.tableEmbed) &&
      Boolean(win) &&
      process.env.RSA_EMBEDDED_TABLE !== '0'

    if (embed && win && this.opts.tableEmbed && startUrl) {
      await this.opts.tableEmbed.openTable(win, startUrl)
      await this.attachEmbeddedPlaywright(startUrl)
      return
    }

    if (mode === 'webkit') {
      await this.launchWebKit(startUrl)
      return
    }

    if (mode === 'safari-cdp') {
      await this.launchSafariThenCdpChrome(startUrl)
      return
    }

    try {
      await this.launchExternalCdpChrome(startUrl)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.log('warn', 'CDP Chrome launch failed, falling back to Playwright Chrome', { error: msg })
      await this.launchExternalChromium(startUrl)
    }
  }

  /** macOS: Safari.app for human checks, then Chrome CDP for parser (Safari has no CDP). */
  private async launchSafariThenCdpChrome(startUrl?: string): Promise<void> {
    const quiet = defaultExternalCdpQuietMs()
    if (process.platform === 'darwin' && startUrl?.startsWith('http')) {
      try {
        await openUrlInSafariApp(startUrl)
        this.logger.log('info', 'Safari.app opened for human verification; parser will use Chrome CDP next')
        if (quiet > 0) await new Promise((r) => setTimeout(r, quiet))
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.log('warn', 'Safari.app open failed, continuing with Chrome CDP only', { error: msg })
      }
    } else {
      this.logger.log('warn', 'safari-cdp mode needs macOS; using Chrome CDP only')
    }
    await this.launchExternalCdpChrome(startUrl, { quietMs: 0 })
  }

  private async launchExternalCdpChrome(
    startUrl?: string,
    opts?: { quietMs?: number }
  ): Promise<void> {
    await this.detachAll()

    const profileDir = join(this.userDataDir, CDP_CHROME_PROFILE_DIR)
    mkdirSync(profileDir, { recursive: true })

    const { browser, page } = await connectExternalChromeCdp({
      port: EXTERNAL_CDP_PORT,
      profileDir,
      startUrl,
      logger: this.logger,
      quietMs: opts?.quietMs ?? defaultExternalCdpQuietMs()
    })

    this.cdpBrowser = browser
    this.page = page
    this.logger.log('info', 'Parser attached over external Chrome CDP', {
      port: EXTERNAL_CDP_PORT,
      url: page.url().slice(0, 160)
    })
  }

  private async launchWebKit(startUrl?: string): Promise<void> {
    await this.detachAll()

    const { webkit } = await import('playwright')
    this.webkitBrowser = await webkit.launch({ headless: false })
    this.context = await this.webkitBrowser.newContext()
    await this.context.addInitScript(TABLE_MAIN_WORLD_MITIGATION)
    this.page = await this.context.newPage()
    if (startUrl?.startsWith('http')) {
      await this.page.goto(startUrl, { waitUntil: 'domcontentloaded' })
    }
    this.logger.log('info', 'Parser attached to Playwright WebKit window', {
      url: this.page.url().slice(0, 160)
    })
  }

  private async attachEmbeddedPlaywright(startUrl: string): Promise<void> {
    const { chromium } = await import('playwright')
    await this.detachAll()

    if (this.opts.tableEmbed) {
      const quiet = embeddedCdpQuietMs()
      await this.opts.tableEmbed.settleBeforePlaywrightAttach(quiet)
      this.logger.log('info', 'Embedded table: delay before CDP attach', { quietMs: quiet })
    }

    const endpoint = electronCdpEndpoint()
    this.logger.log('info', 'Connecting Playwright over CDP (embedded table)', { endpoint, port: ELECTRON_CDP_PORT })

    const browser = await chromium.connectOverCDP(endpoint)
    this.cdpBrowser = browser

    const host = hostFromUrl(startUrl)
    const picked = await this.waitForCasinoPage(browser, host)
    if (!picked) {
      await browser.close().catch(() => undefined)
      this.cdpBrowser = null
      throw new Error(
        `Embedded table: could not find casino page over CDP (port ${ELECTRON_CDP_PORT}). Check remote-debugging-port on Electron.`
      )
    }
    this.page = picked
    this.logger.log('info', 'Playwright attached to embedded page', { url: picked.url().slice(0, 160) })
  }

  private async waitForCasinoPage(browser: Browser, host: string): Promise<Page | null> {
    const deadline = Date.now() + 28000
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
          if (u.startsWith('chrome-extension://')) continue
          if (u.startsWith('file://')) continue
          if (/localhost|127\.0\.0\.1/.test(u) && !u.includes(host)) continue

          if (u.includes(host) || /fresh\.casino|galaxsys|galaxys/i.test(u)) {
            await p.waitForLoadState('domcontentloaded').catch(() => undefined)
            return p
          }
        }
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    return null
  }

  /** Fallback when CDP spawn/connect fails. */
  private async launchExternalChromium(startUrl?: string): Promise<void> {
    await this.detachAll()

    const { chromium } = await import('playwright')
    const profileDir = join(this.userDataDir, PLAYWRIGHT_PROFILE_DIR)
    mkdirSync(profileDir, { recursive: true })

    try {
      this.context = await chromium.launchPersistentContext(profileDir, {
        ...PLAYWRIGHT_TABLE_CONTEXT_OPTS,
        channel: 'chrome'
      })
      await this.context.addInitScript(TABLE_MAIN_WORLD_MITIGATION)
      this.logger.log('info', 'Table window: Playwright Google Chrome (no CDP port)')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.log('warn', 'Google Chrome channel unavailable, using bundled Chromium', { error: msg })
      this.context = await chromium.launchPersistentContext(profileDir, {
        ...PLAYWRIGHT_TABLE_CONTEXT_OPTS
      })
      await this.context.addInitScript(TABLE_MAIN_WORLD_MITIGATION)
    }
    const existing = this.context.pages()
    this.page = existing[0] ?? (await this.context.newPage())
    if (startUrl && this.page) {
      await this.page.addInitScript(TABLE_MAIN_WORLD_MITIGATION).catch(() => undefined)
      await this.page.goto(startUrl, { waitUntil: 'domcontentloaded' })
    }
  }

  private async detachAll(): Promise<void> {
    if (this.cdpBrowser) {
      await this.cdpBrowser.close().catch(() => undefined)
      this.cdpBrowser = null
    }
    if (this.context) {
      await this.context.close().catch(() => undefined)
      this.context = null
    }
    if (this.webkitBrowser) {
      await this.webkitBrowser.close().catch(() => undefined)
      this.webkitBrowser = null
    }
    this.page = null
  }

  async close(): Promise<void> {
    await this.detachAll()

    const win = this.opts.getMainWindow()
    if (win && this.opts.tableEmbed) {
      this.opts.tableEmbed.hide(win)
    }
  }

  async screenshotOnError(_err: unknown, sessionId?: string): Promise<string | null> {
    const dir = join(this.userDataDir, 'screenshots')
    mkdirSync(dir, { recursive: true })
    const name = `fail-${sessionId ?? 'na'}-${Date.now()}.png`
    const path = join(dir, name)
    try {
      if (this.page) {
        await this.page.screenshot({ path, fullPage: true })
        return path
      }
    } catch {
      /* ignore */
    }
    return null
  }
}
