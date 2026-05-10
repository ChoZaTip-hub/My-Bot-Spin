import { z } from 'zod'

const RowSchema = z
  .array(z.number().int().min(0).max(36))
  .length(5)
  .superRefine((arr, ctx) => {
    if (new Set(arr).size !== arr.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Five pocket numbers must be distinct' })
    }
  })

/** JSON object with string keys "0".."36", each value is five distinct numbers. */
export const FeedTableMappingJsonSchema = z
  .record(z.string(), RowSchema)
  .superRefine((rec, ctx) => {
    for (let i = 0; i <= 36; i++) {
      const k = String(i)
      if (rec[k] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing outcome ${i}`,
          path: [k]
        })
      }
    }
    for (const key of Object.keys(rec)) {
      const n = Number.parseInt(key, 10)
      if (!Number.isInteger(n) || n < 0 || n > 36) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid outcome key "${key}" (expected 0–36)`,
          path: [key]
        })
      }
    }
  })

export type FeedTableMappingJson = z.infer<typeof FeedTableMappingJsonSchema>

/** Normalized lookup by numeric outcome 0–36. */
export function parseFeedTableMappingJson(raw: unknown): Readonly<Record<number, readonly number[]>> {
  const parsed = FeedTableMappingJsonSchema.parse(raw)
  const out: Record<number, readonly number[]> = {}
  for (let i = 0; i <= 36; i++) {
    out[i] = parsed[String(i)]!
  }
  return out
}

/** Seeded editable copy of the built-in VIP grid (`vip-feed.ts`). */
export const BUILTIN_VIP_FEED_TABLE_ID = 'builtin-vip-feed' as const
