import { z } from 'zod'
import type { TeachingEvent } from './TeachingRecorder'

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Single UI target remembered from a teaching interaction */
export const RouletteHintEntrySchema = z.object({
  selectorHint: z.string(),
  clientX: z.number().optional(),
  clientY: z.number().optional(),
  pageX: z.number().optional(),
  pageY: z.number().optional(),
  frameUrl: z.string().optional()
})

export type RouletteHintEntry = z.infer<typeof RouletteHintEntrySchema>

/** File stored under userData/teaching/mappings/<key>.json */
export const RouletteTeachingMappingSchema = z.object({
  version: z.literal(1).default(1),
  /** Chip denomination → where you clicked (e.g. 1, 2, 0.1 as string keys in JSON) */
  chips: z.record(z.string(), RouletteHintEntrySchema).optional(),
  /** Straight-up pocket 0–36 */
  straights: z.record(z.string(), RouletteHintEntrySchema).optional(),
  confirm: RouletteHintEntrySchema.optional(),
  clear: RouletteHintEntrySchema.optional()
})

export type RouletteTeachingMapping = z.infer<typeof RouletteTeachingMappingSchema>

export function teachingEventToHint(ev: TeachingEvent): RouletteHintEntry {
  return {
    selectorHint: ev.selectorHint,
    clientX: ev.clientX,
    clientY: ev.clientY,
    pageX: ev.pageX,
    pageY: ev.pageY,
    frameUrl: ev.frameUrl
  }
}

const KNOWN_CHIPS = [100, 50, 25, 10, 5, 2, 1, 0.1] as const

/**
 * Best-effort guess from raw recording (straight numbers, chip-like labels, confirm/clear).
 * Conflicting chip vs number labels may need hand-editing in the JSON.
 */
export function inferRouletteMappingFromEvents(events: TeachingEvent[]): RouletteTeachingMapping {
  const chips: Record<string, RouletteHintEntry> = {}
  const straights: Record<string, RouletteHintEntry> = {}
  let confirm: RouletteHintEntry | undefined
  let clear: RouletteHintEntry | undefined

  const rev = [...events].reverse()
  for (const ev of rev) {
    if (ev.kind !== 'click' && ev.kind !== 'change') continue
    const text = (ev.textSnippet ?? '').replace(/\s+/g, ' ').trim()
    const lower = text.toLowerCase()

    if (!confirm && /confirm|spin|bet|ставк|спин|подтвер|repeat|повтор|place\s+bet/i.test(lower)) {
      confirm = teachingEventToHint(ev)
      continue
    }
    if (!clear && /clear|очист|cancel|отмен/i.test(lower)) {
      clear = teachingEventToHint(ev)
      continue
    }

    const plainNum = /^(\d{1,2})$/.exec(text)
    if (plainNum) {
      const n = Number.parseInt(plainNum[1]!, 10)
      if (n >= 0 && n <= 36 && straights[String(n)] === undefined) {
        straights[String(n)] = teachingEventToHint(ev)
      }
    }

    for (const chip of KNOWN_CHIPS) {
      const key = String(chip)
      let matched = false
      if (chip === 0.1) {
        matched = /^0[.,]1(?:\s|$)/i.test(text) || /^0\.1(?:\s|$)/i.test(text)
      } else {
        matched = new RegExp(`^\\s*${escapeRegex(key)}(?:[.,]0+)?\\s*$`).test(text)
      }
      if (matched && chips[key] === undefined) {
        chips[key] = teachingEventToHint(ev)
      }
    }
  }

  return RouletteTeachingMappingSchema.parse({
    version: 1 as const,
    chips: Object.keys(chips).length ? chips : undefined,
    straights: Object.keys(straights).length ? straights : undefined,
    confirm,
    clear
  })
}
