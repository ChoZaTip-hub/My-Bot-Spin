import type { AppSettings } from '@modules/shared/ipc-contract'

export type TableBrowserMode = 'embedded' | 'cdp-chrome' | 'webkit' | 'safari-cdp'

/**
 * Resolves how the live table window is opened.
 * Safari.app cannot use CDP; mode `webkit` uses Playwright WebKit (Safari engine, separate window).
 */
export function resolveTableBrowserMode(settings: AppSettings): TableBrowserMode {
  const env = process.env.RSA_TABLE_BROWSER?.trim().toLowerCase()
  if (process.env.RSA_EMBEDDED_TABLE === '0') {
    if (env === 'webkit') return 'webkit'
    if (env === 'safari' || env === 'safari-cdp') return 'safari-cdp'
    if (env === 'embedded') return 'embedded'
    return 'cdp-chrome'
  }
  if (process.env.RSA_EMBEDDED_TABLE === '1') return 'embedded'
  if (env === 'webkit') return 'webkit'
  if (env === 'safari' || env === 'safari-cdp') return 'safari-cdp'
  if (env === 'cdp' || env === 'cdp-chrome' || env === 'chrome') return 'cdp-chrome'
  if (env === 'embedded') return 'embedded'
  if (settings.useEmbeddedCasinoTable) return 'embedded'
  const fromSettings = settings.tableBrowser
  if (
    fromSettings === 'webkit' ||
    fromSettings === 'cdp-chrome' ||
    fromSettings === 'embedded' ||
    fromSettings === 'safari-cdp'
  ) {
    return fromSettings
  }
  return 'cdp-chrome'
}
