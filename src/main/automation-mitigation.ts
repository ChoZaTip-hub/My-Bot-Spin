/**
 * Runs in the page main world (Electron executeJavaScript / Playwright addInitScript).
 * Trims obvious automation markers; does not defeat intentional site protections.
 */
export const TABLE_MAIN_WORLD_MITIGATION = `(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true })
  } catch (_) {}
  try {
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol
  } catch (_) {}
})();`
