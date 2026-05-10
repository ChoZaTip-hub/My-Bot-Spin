import { BrowserView, type BrowserWindow } from 'electron'
import type { Logger } from './logger'

/** Navigation column width (Tailwind `w-52` + padding) — must match renderer. */
export const NAV_COLUMN_PX = 220

/**
 * Share of the content area *below the header* used for the embedded table (top strip).
 * Must stay in sync with App.tsx flex split (`flex-[14]` / `flex-[11]` ≈ 56/44).
 */
export const UPPER_EMBED_HEIGHT_RATIO = 14 / (14 + 11)

const HEADER_OFFSET_Y = 52
const PAD = 6

/**
 * Embeds the casino table in the top portion of the main window (above forms / timeline).
 * Uses a persistent session partition so login survives restarts.
 */
export class TableEmbedManager {
  private view: BrowserView | null = null
  private attachedWin: BrowserWindow | null = null
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
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      })
      this.logger.log('info', 'Created BrowserView for embedded table')
    }

    win.setBrowserView(this.view)
    this.layout(win)

    const wc = this.view.webContents
    const u = startUrl.trim()
    if (!u.startsWith('http')) {
      throw new Error('Invalid table URL')
    }
    const cur = wc.getURL()
    if (cur !== u) {
      await wc.loadURL(u)
    }
    this.logger.log('info', 'Embedded table navigated', { url: u.slice(0, 120) })
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
    this.detachWindowListeners()
  }

  getWebContents(): import('electron').WebContents | null {
    return this.view?.webContents ?? null
  }
}
