import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import type { Logger } from '../logger'

/** Subfolder under Electron userData — cookies & login persist here between app runs. */
const PROFILE_DIR_NAME = 'playwright-chromium-profile'

export class BrowserHost {
  private context: BrowserContext | null = null
  private page: Page | null = null

  constructor(
    private readonly logger: Logger,
    private readonly userDataDir: string
  ) {}

  getPage(): Page | null {
    return this.page
  }

  async launch(startUrl?: string): Promise<void> {
    const { chromium } = await import('playwright')
    const profileDir = join(this.userDataDir, PROFILE_DIR_NAME)
    mkdirSync(profileDir, { recursive: true })

    if (!this.context) {
      this.logger.log('info', 'Launching Playwright Chromium (persistent profile)', { profileDir })
      /** Same cookies/localStorage as last time — log in once in this window, then reuse. */
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
    if (this.context) {
      await this.context.close()
    }
    this.context = null
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
