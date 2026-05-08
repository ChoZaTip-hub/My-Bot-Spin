import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { createLogger, forwardLogsToRenderer } from './logger'

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

    const browserHost = new BrowserHost(baseLogger.child('playwright'), userData)
    const getWindow = (): BrowserWindow | null => mainWindow
    const live = new LiveSessionController(db, baseLogger.child('session'), browserHost, getWindow)

    mainWindow = createMainWindow()
    const logger = forwardLogsToRenderer(mainWindow, baseLogger)
    registerIpc({ db, logger, browserHost, live, ipcMain, dialog })

    mainWindow.on('closed', () => {
      mainWindow = null
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
