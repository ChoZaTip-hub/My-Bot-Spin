/** Electron embedded table + Playwright CDP attach (see `index.ts` remote-debugging-port). */
export const ELECTRON_CDP_PORT = process.env.RSA_ELECTRON_CDP_PORT ?? process.env.RSA_CDP_PORT ?? '17789'

/** External Google Chrome / Chromium launched with --remote-debugging-port (parser attach). */
export const EXTERNAL_CDP_PORT = process.env.RSA_EXTERNAL_CDP_PORT ?? '9222'

/** @deprecated Use {@link ELECTRON_CDP_PORT} or {@link EXTERNAL_CDP_PORT}. */
export const RSA_CDP_PORT = ELECTRON_CDP_PORT

export function electronCdpEndpoint(): string {
  return `http://127.0.0.1:${ELECTRON_CDP_PORT}`
}

export function externalCdpEndpoint(): string {
  return `http://127.0.0.1:${EXTERNAL_CDP_PORT}`
}
