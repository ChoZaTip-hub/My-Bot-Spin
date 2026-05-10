import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Browser, BrowserContext, Page } from 'playwright'
import { RSA_CDP_PORT } from '../cdp-config'
import type { TableEmbedManager } from '../table-embed'
import type { Logger } from '../logger'

/** Subfolder under Electron userData — cookies when using external Chromium fallback. */
const PROFILE_DIR_NAME = 'playwright-chromium-profile'

export type BrowserHostOptions = {
  getMainWindow: () => BrowserWindow | null
  /** Right-pane embedded casino (BrowserView). */
  tableEmbed: TableEmbedManager | null
  /**
   * When true (default), session uses embedded BrowserView + CDP.
   * Set env `RSA_EMBEDDED_TABLE=0` to use the legacy separate Chromium window.
   */
  useEmbeddedTable: boolean
}

function hostFromUrl(startUrl: string): string {
  try {
    return new URL(startUrl).hostname
  } catch {
    return 'fresh.casino'
  }
}

export class BrowserHost {
  private context: BrowserContext | null = null
  private page: Page | null = null
  /** CDP-connected browser when using embedded table */
  private cdpBrowser: Browser | null = null

  constructor(
    private readonly logger: Logger,
    private readonly userDataDir: string,
    private readonly opts: BrowserHostOptions
  ) {}

  getPage(): Page | null {
    return this.page
  }

  async launch(startUrl?: string): Promise<void> {
    const win = this.opts.getMainWindow()
    const embed =
      this.opts.useEmbeddedTable !== false &&
      Boolean(startUrl?.startsWith('http')) &&
      Boolean(this.opts.tableEmbed) &&
      Boolean(win)

    if (embed && win && this.opts.tableEmbed && startUrl) {
      await this.opts.tableEmbed.openTable(win, startUrl)
      await this.attachEmbeddedPlaywright(startUrl)
      return
    }

    await this.launchExternalChromium(startUrl)
  }

  private async attachEmbeddedPlaywright(startUrl: string): Promise<void> {
    const { chromium } = await import('playwright')

    if (this.context) {
      await this.context.close().catch(() => undefined)
      this.context = null
    }
    if (this.cdpBrowser) {
      await this.cdpBrowser.close().catch(() => undefined)
      this.cdpBrowser = null
    }
    this.page = null

    const endpoint = `http://127.0.0.1:${RSA_CDP_PORT}`
    this.logger.log('info', 'Connecting Playwright over CDP (embedded table)', { endpoint })

    const browser = await chromium.connectOverCDP(endpoint)
    this.cdpBrowser = browser

    const host = hostFromUrl(startUrl)
    const picked = await this.waitForCasinoPage(browser, host)
    if (!picked) {
      await browser.close().catch(() => undefined)
      this.cdpBrowser = null
      throw new Error(
        'Embedded table: could not find casino page over CDP. Ensure remote-debugging-port matches RSA_CDP_PORT.'
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

  private async launchExternalChromium(startUrl?: string): Promise<void> {
    if (this.cdpBrowser) {
      await this.cdpBrowser.close().catch(() => undefined)
      this.cdpBrowser = null
    }

    const { chromium } = await import('playwright')
    const profileDir = join(this.userDataDir, PROFILE_DIR_NAME)
    mkdirSync(profileDir, { recursive: true })

    if (!this.context) {
      this.logger.log('info', 'Launching Playwright Chromium (external window, persistent profile)', {
        profileDir
      })
      this.context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        viewport: { width: 1280, height: 800 },
        locale: 'ru-RU'
      })
      const existing = this.context.pages()
      this.page = existing[0] ?? (await this.context.newPage())
    }
    if (startUrl && this.page) {
      await this.page.goto(startUrl, { waitUntil: 'domcontentloaded' })
    }
  }

  async close(): Promise<void> {
    if (this.cdpBrowser) {
      await this.cdpBrowser.close().catch(() => undefined)
      this.cdpBrowser = null
    }
    if (this.context) {
      await this.context.close().catch(() => undefined)
      this.context = null
    }
    this.page = null

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
