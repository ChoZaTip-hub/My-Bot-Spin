import { BrowserView, type BrowserWindow, session } from 'electron'
import type { Logger } from './logger'
import { TABLE_MAIN_WORLD_MITIGATION } from './automation-mitigation'

/** Navigation column width — match renderer `w-52` (13rem = 208px at 16px root) + small slack. */
export const NAV_COLUMN_PX = 208

/**
 * Strip Electron from the default UA so casino sites that block or degrade Electron
 * still receive a normal Chrome-like string (Safari works; embedded Chromium often did not).
 */
function chromeLikeUserAgent(): string {
  const raw = session.defaultSession.getUserAgent()
  return raw
    .replace(/\s*Electron\/[\d.]+\s*/gi, ' ')
    .replace(/\s*RSA\/[^\s]+\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Share of the content area *below the header* used for the embedded table (top strip).
 * Must stay in sync with App.tsx flex split (`flex-[14]` / `flex-[11]` ≈ 56/44).
 */
export const UPPER_EMBED_HEIGHT_RATIO = 14 / (14 + 11)

/** App chrome header (title row) — keep slightly above measured height so the strip is not clipped. */
const HEADER_OFFSET_Y = 58
const PAD = 6

/**
 * Avoid forcing a full reload when the shell already settled on the same page (redirects, trailing slash, locale prefix).
 */
function sameTableDocument(cur: string, requested: string): boolean {
  if (cur === requested) return true
  if (cur === 'about:blank' || !cur.startsWith('http')) return false
  try {
    const a = new URL(cur)
    const b = new URL(requested)
    if (a.origin !== b.origin) return false
    const pa = (a.pathname.replace(/\/$/, '') || '/') + a.search
    const pb = (b.pathname.replace(/\/$/, '') || '/') + b.search
    return pa === pb
  } catch {
    return false
  }
}

/**
 * Embeds the casino table in the top portion of the main window (above forms / timeline).
 * Uses a persistent session partition so login survives restarts.
 */
export class TableEmbedManager {
  private view: BrowserView | null = null
  private attachedWin: BrowserWindow | null = null
  private mitigationHookInstalled = false
  private readonly onResize = (): void => {
    if (this.attachedWin && this.view) this.layout(this.attachedWin)
  }

  constructor(private readonly logger: Logger) {}

  attach(win: BrowserWindow): void {
    if (this.attachedWin === win) return
    this.detachWindowListeners()
    this.attachedWin = win
    win.on('resize', this.onResize)
    win.on('maximize', this.onResize)
    win.on('enter-full-screen', this.onResize)
    win.on('leave-full-screen', this.onResize)
    if (this.view) this.layout(win)
  }

  private detachWindowListeners(): void {
    if (!this.attachedWin) return
    this.attachedWin.removeListener('resize', this.onResize)
    this.attachedWin.removeListener('maximize', this.onResize)
    this.attachedWin.removeListener('enter-full-screen', this.onResize)
    this.attachedWin.removeListener('leave-full-screen', this.onResize)
    this.attachedWin = null
  }

  /**
   * Show BrowserView and load URL. Safe to call repeatedly (navigates existing view).
   */
  async openTable(win: BrowserWindow, startUrl: string): Promise<void> {
    this.attach(win)

    if (!this.view) {
      this.view = new BrowserView({
        webPreferences: {
          partition: 'persist:galaxsys-table',
          /** Many real-money games rely on WASM / third-party scripts that break under OS-level sandbox. */
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      })
      this.logger.log('info', 'Created BrowserView for embedded table')
    }

    const wc = this.view.webContents

    if (!this.mitigationHookInstalled) {
      this.mitigationHookInstalled = true
      wc.on('did-finish-load', () => {
        void this.injectMainWorldMitigation()
      })
    }

    win.setBrowserView(this.view)
    this.layout(win)

    try {
      wc.setUserAgent(chromeLikeUserAgent())
    } catch {
      /* ignore */
    }
    const u = startUrl.trim()
    if (!u.startsWith('http')) {
      throw new Error('Invalid table URL')
    }

    if (!wc.listenerCount('did-fail-load')) {
      wc.on('did-fail-load', (_ev, code, desc, url, isMainFrame) => {
        if (!isMainFrame) return
        this.logger.log('warn', 'Embedded table navigation failed', {
          code,
          desc,
          url: url.slice(0, 200)
        })
      })
    }

    const cur = wc.getURL()
    if (!sameTableDocument(cur, u)) {
      try {
        await wc.loadURL(u)
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        this.logger.log('error', 'Embedded table loadURL rejected', { url: u.slice(0, 200), detail })
        throw new Error(
          `Table did not load (${detail}). ` +
            `If the console shows DNS / ERR_NAME_NOT_RESOLVED (-105), fix network or DNS. ` +
            `Otherwise turn off «Embed casino table» in Settings (separate Chrome window), ` +
            `or set env RSA_EMBEDDED_TABLE=0.`
        )
      }
    }
    this.layout(win)
    await new Promise((r) => setTimeout(r, 200))
    this.layout(win)
    await this.injectMainWorldMitigation()
    this.logger.log('info', 'Embedded table navigated', { url: u.slice(0, 120) })
  }

  /**
   * Wait until navigation settles, then pause so human-verification widgets can complete
   * before Playwright attaches over CDP (debugger attach often resets those checks).
   */
  async settleBeforePlaywrightAttach(extraQuietMs: number): Promise<void> {
    const wc = this.view?.webContents
    if (!wc) return
    const navDeadline = Date.now() + 45_000
    while (wc.isLoading() && Date.now() < navDeadline) {
      await new Promise((r) => setTimeout(r, 150))
    }
    await new Promise((r) => setTimeout(r, Math.max(0, extraQuietMs)))
  }

  private async injectMainWorldMitigation(): Promise<void> {
    const wc = this.view?.webContents
    if (!wc) return
    try {
      await wc.executeJavaScript(TABLE_MAIN_WORLD_MITIGATION)
    } catch {
      /* cross-origin or page not ready */
    }
  }

  layout(win: BrowserWindow): void {
    if (!this.view) return
    const { width, height } = win.getContentBounds()
    const contentTop = HEADER_OFFSET_Y
    const contentH = Math.max(0, height - contentTop - PAD)
    const embedH = Math.max(200, Math.floor(contentH * UPPER_EMBED_HEIGHT_RATIO) - PAD)
    const left = NAV_COLUMN_PX + PAD
    const top = contentTop
    const w = Math.max(200, width - left - PAD * 2)
    const h = embedH
    this.view.setBounds({ x: left, y: top, width: w, height: h })
    this.view.setAutoResize({ width: false, height: false })
    this.logger.log('debug', 'Embedded table bounds', { x: left, y: top, w, h })
  }

  /** Remove view from window (keeps WebContents alive for same session next open). */
  hide(win: BrowserWindow): void {
    try {
      win.removeBrowserView(this.view!)
    } catch {
      /* already removed */
    }
    try {
      this.view?.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    } catch {
      /* ignore */
    }
  }

  destroy(win: BrowserWindow): void {
    this.hide(win)
    this.view = null
    this.mitigationHookInstalled = false
    this.detachWindowListeners()
  }

  getWebContents(): import('electron').WebContents | null {
    return this.view?.webContents ?? null
  }
}
