import type { WebContents } from 'electron'
import { session } from 'electron'

/** Same partition string as {@link TableEmbedManager} embedded casino view. */
export const CASINO_EMBED_PARTITION = 'persist:galaxsys-table'

let partitionHeadersHooked = false

function platformChUaPlatform(): string {
  if (process.platform === 'darwin') return '"macOS"'
  if (process.platform === 'win32') return '"Windows"'
  return '"Linux"'
}

/**
 * Rewrite Client Hint headers that mention Electron — many bot stacks key off them.
 * Uses the bundled Chromium major version so values stay plausible.
 */
function scrubClientHints(headers: Record<string, string | string[] | undefined>): void {
  const chromeFull = process.versions.chrome ?? '131.0.0.0'
  const major = chromeFull.split('.')[0] ?? '131'
  const secChUa = `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`
  for (const key of Object.keys(headers)) {
    if (!key.toLowerCase().startsWith('sec-ch-ua')) continue
    const raw = headers[key]
    if (raw == null) continue
    const s = Array.isArray(raw) ? raw.join(', ') : String(raw)
    if (!/electron/i.test(s)) continue
    const lk = key.toLowerCase()
    if (lk === 'sec-ch-ua') headers[key] = secChUa
    else if (lk === 'sec-ch-ua-mobile') headers[key] = '?0'
    else if (lk === 'sec-ch-ua-platform') headers[key] = platformChUaPlatform()
    else if (lk === 'sec-ch-ua-full-version-list' || lk === 'sec-ch-ua-full-version') {
      headers[key] = `"Google Chrome";v="${chromeFull}", "Chromium";v="${chromeFull}", "Not_A Brand";v="24.0.0.0"`
    } else {
      delete headers[key]
    }
  }
}

/** Register once: strip Electron from outgoing CH headers for the embedded casino session. */
export function ensureCasinoEmbedSessionHardening(): void {
  if (partitionHeadersHooked) return
  partitionHeadersHooked = true
  const s = session.fromPartition(CASINO_EMBED_PARTITION)
  s.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders }
    scrubClientHints(requestHeaders)
    callback({ requestHeaders })
  })
}

const WEBDRIVER_PATCH = `(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get() { return false },
      configurable: true
    })
  } catch (_) {
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get() { return false },
        configurable: true
      })
    } catch (_) {}
  }
})()`

const patched = new WeakSet<WebContents>()

/** Run early on each top-level document — best-effort; cannot defeat all TLS / behaviour probes. */
export function attachEmbedDomAutomationMildPatch(wc: WebContents): void {
  if (patched.has(wc)) return
  patched.add(wc)
  const inject = (): void => {
    void wc.executeJavaScript(WEBDRIVER_PATCH, false).catch(() => undefined)
  }
  wc.on('dom-ready', inject)
}
