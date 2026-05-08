import { z } from 'zod'

const RowSchema = z.union([
  z.string().transform((s) => s.trim()),
  z.number()
])

/** Parse CSV with one outcome per line or first column; values 0–36. */
export function parseSpinCsv(text: string): number[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out: number[] = []
  for (const line of lines) {
    const cell = line.includes(',') ? line.split(',')[0] : line
    const parsed = RowSchema.safeParse(cell)
    if (!parsed.success) continue
    const v =
      typeof parsed.data === 'number' ? parsed.data : Number.parseInt(parsed.data, 10)
    if (!Number.isInteger(v) || v < 0 || v > 36) continue
    out.push(v)
  }
  return out
}
