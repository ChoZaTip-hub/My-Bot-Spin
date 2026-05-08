# Roulette Strategy Agent

Local desktop app (Electron) for **roulette strategy simulation**, **session logging**, **dry-run browser observation**, and **optional user-confirmed** semi-automatic assistance. It is **not** designed for stealth automation, CAPTCHA bypass, or evading site protections.

## Stack

- Electron + electron-vite + Vite 6  
- React 19 + TypeScript (strict)  
- Playwright (Chromium, visible browser — no stealth plugins)  
- SQLite + Drizzle ORM + `better-sqlite3`  
- Zod, Vitest, Tailwind (renderer)

## Quick start

```bash
npm install
npm run dev
```

Other scripts:

- `npm run typecheck` — main/preload/modules + renderer  
- `npm run test` — unit tests (Vitest)  
- `npm run lint` — ESLint (flat config)  
- `npm run build` — package desktop bundles (requires toolchain for native modules)

## Architecture

- **Pure modules** under `src/modules/strategy-engine`, `simulator`, `risk-manager`, `policy` — no Playwright imports.  
- **Parser / executor** interfaces live under `src/modules/parser` and `src/modules/executor`; Playwright-specific glue is in `src/main/playwright`.  
- **IPC** is the only bridge to the renderer; preload exposes a small `window.rsa` API.  
- **SQLite** file defaults to the OS app userData directory (`roulette-agent.sqlite`).

See `examples/strategies` for JSON configs and `examples/spins/sample.csv` for import format.

## Compliance boundaries

- No anti-detection, fingerprint spoofing, proxy rotation, or CAPTCHA solving.  
- Execution paths are **policy gated**; **dry-run only** is a hard switch in Settings.  
- `confirmed-action` mode requires explicit confirmation unless **per-session execution consent** is enabled in Settings **and** the executor feature flag is on.

## Environment

Copy `.env.example` to `.env` for local overrides (optional). `DB_PATH` and `LOG_LEVEL` are read in the main process when set in the shell environment launching Electron.

### Main process bundle

The packaged main entry is **CommonJS** (`out/main/index.cjs`) so it stays compatible with `package.json` `"type": "module"` without hitting Node’s ESM/CJS interop edge cases around `electron` and native dependencies.

### Troubleshooting

If `require('electron')` behaves like a **string path** (or `electron.app` is undefined), your shell may have **`ELECTRON_RUN_AS_NODE=1`**, which forces Node mode and disables the normal Electron main API. The `dev`, `preview`, and `start` scripts unset it via `env -u ELECTRON_RUN_AS_NODE`. For a manual run, use:

`env -u ELECTRON_RUN_AS_NODE npx electron .`
