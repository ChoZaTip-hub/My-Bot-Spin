import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export type Logger = {
  log: (level: LogLevel, message: string, meta?: Record<string, unknown>) => void
  child: (scope: string) => Logger
}

export function createLogger(options: {
  minLevel: LogLevel
  logDir: string
  notify?: (level: LogLevel, line: string) => void
}): Logger {
  mkdirSync(options.logDir, { recursive: true })
  const file = join(options.logDir, 'app.log')

  const write = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[options.minLevel]) return
    const ts = new Date().toISOString()
    const line = `${ts} [${level.toUpperCase()}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`
    appendFileSync(file, line, { encoding: 'utf8' })
    options.notify?.(level, line.trim())
  }

  const base: Logger = {
    log: write,
    child(scope: string) {
      return {
        log(level, message, meta) {
          write(level, `[${scope}] ${message}`, meta)
        },
        child: (s: string) => base.child(`${scope}:${s}`)
      }
    }
  }
  return base
}

export function forwardLogsToRenderer(win: BrowserWindow | null, logger: Logger): Logger {
  return {
    ...logger,
    log(level, message, meta) {
      logger.log(level, message, meta)
      if (win && !win.isDestroyed()) {
        win.webContents.send('log:line', { level, message, meta, at: Date.now() })
      }
    }
  }
}
