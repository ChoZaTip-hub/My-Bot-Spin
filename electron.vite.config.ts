import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/** Rollup sometimes emits bare side-effect imports that crash Electron's ESM/CJS interop loader. */
function stripHarmfulBareImports(): Plugin {
  const strip = (code: string): string =>
    code
      .replace(/import "drizzle-orm\/sqlite-core";(\r?\n)?/g, '')
      .replace(/import "zod";(\r?\n)?/g, '')
      .replace(/import __cjs_mod__ from "node:module";(\r?\n)?/g, '')
      .replace(/const require2 = __cjs_mod__\.createRequire\(import\.meta\.url\);(\r?\n)?/g, '')

  return {
    name: 'strip-harmful-bare-imports',
    closeBundle() {
      const mainDir = resolve(__dirname, 'out/main')
      const dirs = [mainDir, resolve(__dirname, 'out/preload')]
      for (const base of dirs) {
        if (!existsSync(base)) continue
        for (const name of readdirSync(base)) {
          if (!name.endsWith('.js') && !name.endsWith('.mjs') && !name.endsWith('.cjs')) continue
          const p = join(base, name)
          const raw = readFileSync(p, 'utf8')
          const next = strip(raw)
          if (next !== raw) writeFileSync(p, next)
        }
        const chunksDir = join(base, 'chunks')
        if (!existsSync(chunksDir)) continue
        for (const name of readdirSync(chunksDir)) {
          if (!name.endsWith('.js') && !name.endsWith('.mjs') && !name.endsWith('.cjs')) continue
          const p = join(chunksDir, name)
          const raw = readFileSync(p, 'utf8')
          const next = strip(raw)
          if (next !== raw) writeFileSync(p, next)
        }
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), stripHarmfulBareImports()],
    resolve: {
      alias: {
        '@modules': resolve('src/modules')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), stripHarmfulBareImports()],
    resolve: {
      alias: {
        '@modules': resolve('src/modules')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@modules': resolve(__dirname, 'src/modules')
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
