import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RouletteTeachingMappingSchema, type RouletteTeachingMapping } from './roulette-mapping'

function mappingsDir(userDataDir: string): string {
  return join(userDataDir, 'teaching', 'mappings')
}

function sanitizeFileKey(key: string): string {
  return key.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'default'
}

function hostKeyFromUrl(startUrl: string): string {
  try {
    const u = new URL(startUrl)
    return sanitizeFileKey(`${u.hostname}${u.pathname.replace(/\/$/, '')}`)
  } catch {
    return 'table'
  }
}

/**
 * Load optional roulette UI hints for any embedded table.
 * Resolution: explicit session key → file; else JSON named after host+path of startUrl.
 */
export function loadRouletteMapping(
  userDataDir: string,
  explicitKey: string | undefined | null,
  startUrl: string | undefined
): RouletteTeachingMapping | null {
  const dir = mappingsDir(userDataDir)
  const candidates: string[] = []
  if (explicitKey?.trim()) {
    candidates.push(join(dir, `${sanitizeFileKey(explicitKey)}.json`))
  }
  if (startUrl?.startsWith('http')) {
    candidates.push(join(dir, `${hostKeyFromUrl(startUrl)}.json`))
  }

  const seen = new Set<string>()
  for (const path of candidates) {
    if (seen.has(path)) continue
    seen.add(path)
    if (!existsSync(path)) continue
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
      return RouletteTeachingMappingSchema.parse(raw)
    } catch {
      continue
    }
  }
  return null
}
