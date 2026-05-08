import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import type { Logger } from '../logger'

export class BrowserHost {
  private browser: Browser | null = null
  private page: Page | null = null

  constructor(
    private readonly logger: Logger,
    private readonly userDataDir: string
  ) {}

  getPage(): Page | null {
    return this.page
  }

  async launch(startUrl?: string): Promise<void> {
    if (this.browser) return
    this.logger.log('info', 'Launching Playwright Chromium (visible, no stealth)')
    const { chromium } = await import('playwright')
    this.browser = await chromium.launch({ headless: false })
    const context = await this.browser.newContext()
    this.page = await context.newPage()
    if (startUrl) {
      await this.page.goto(startUrl, { waitUntil: 'domcontentloaded' })
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
    }
    this.browser = null
    this.page = null
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
