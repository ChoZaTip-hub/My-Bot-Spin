/** Playwright `connectOverCDP` port — must match `remote-debugging-port` on Electron (see `index.ts`). */
export const RSA_CDP_PORT = process.env.RSA_CDP_PORT ?? '17789'
