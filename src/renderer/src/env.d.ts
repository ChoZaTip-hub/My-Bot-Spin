/// <reference types="vite/client" />

import type { RendererApi } from './bridge'

declare global {
  interface Window {
    rsa: RendererApi
  }
}

export {}
