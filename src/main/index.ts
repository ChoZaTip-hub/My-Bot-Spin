import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { RSA_CDP_PORT } from './cdp-config'
import { createLogger, forwardLogsToRenderer } from './logger'

/** Reduces obvious automation signals in Chromium (helps some bot checks; not a guarantee). */
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')

/** Lets Playwright attach to the same Electron process (embedded BrowserView). */
app.commandLine.appendSwitch('remote-debugging-port', RSA_CDP_PORT)

let mainWindow: BrowserWindow | null = null

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Roulette Strategy Agent',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) {
    void win.loadURL(url)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    const { createDb } = await import('@modules/db/client')
    const { registerIpc } = await import('./ipc/registerIpc')
    const { BrowserHost } = await import('./playwright/BrowserHost')
    const { LiveSessionController } = await import('./session/LiveSessionController')
    const { seedIfEmpty } = await import('./seed')

    const userData = app.getPath('userData')
    const dbPath = process.env['DB_PATH'] ?? join(userData, 'roulette-agent.sqlite')
    const { db } = createDb(dbPath)
    const rawLevel = process.env['LOG_LEVEL']
    const minLevel =
      rawLevel === 'debug' || rawLevel === 'info' || rawLevel === 'warn' || rawLevel === 'error'
        ? rawLevel
        : 'info'
    const baseLogger = createLogger({
      minLevel,
      logDir: join(userData, 'logs')
    })
    await seedIfEmpty(db, baseLogger.child('seed'))

    const { TableEmbedManager } = await import('./table-embed')
    const tableEmbed = new TableEmbedManager(baseLogger.child('embed'))
    const browserHost = new BrowserHost(baseLogger.child('playwright'), userData, {
      getMainWindow: (): BrowserWindow | null => mainWindow,
      tableEmbed,
      useEmbeddedTable: process.env.RSA_EMBEDDED_TABLE !== '0'
    })
    const getWindow = (): BrowserWindow | null => mainWindow
    const live = new LiveSessionController(db, baseLogger.child('session'), browserHost, getWindow)

    const { TeachingRecorder } = await import('./teaching/TeachingRecorder')
    const teaching = new TeachingRecorder(browserHost, baseLogger.child('teaching'), userData, getWindow)

    mainWindow = createMainWindow()
    tableEmbed.attach(mainWindow)
    const logger = forwardLogsToRenderer(mainWindow, baseLogger)
    registerIpc({ db, logger, browserHost, live, teaching, ipcMain, dialog, userDataDir: userData })

    mainWindow.on('closed', () => {
      const w = mainWindow
      mainWindow = null
      if (w) tableEmbed.destroy(w)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
        tableEmbed.attach(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
