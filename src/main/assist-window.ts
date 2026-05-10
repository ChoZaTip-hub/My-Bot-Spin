import { join } from 'node:path'
import { BrowserWindow } from 'electron'

let assistWindow: BrowserWindow | null = null

/** Must match renderer detection in App.tsx (`assist=1`). */
export const ASSIST_WINDOW_QUERY = { assist: '1' } as const

export function focusAssistWindow(): void {
  if (assistWindow && !assistWindow.isDestroyed()) {
    assistWindow.focus()
  }
}

export function createAssistWindow(): BrowserWindow {
  if (assistWindow && !assistWindow.isDestroyed()) {
    assistWindow.focus()
    return assistWindow
  }

  assistWindow = new BrowserWindow({
    width: 440,
    height: 680,
    minWidth: 380,
    minHeight: 520,
    title: 'Assist — VIP Five',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    const base = String(devUrl).replace(/\/$/, '')
    const url = new URL(`${base}/`)
    url.searchParams.set('assist', '1')
    void assistWindow.loadURL(url.href)
  } else {
    void assistWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: ASSIST_WINDOW_QUERY
    })
  }

  assistWindow.on('closed', () => {
    assistWindow = null
  })

  return assistWindow
}
