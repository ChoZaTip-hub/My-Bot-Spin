import { z } from 'zod'
import { DecisionSchema } from './decision'
import { StrategyConfigSchema } from './strategy-config'
import { AppModeSchema } from './modes'
export { IPC_CHANNELS } from './ipc-channels'

export const SettingsSchema = z.object({
  locale: z.enum(['en', 'ru']).default('en'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  dryRunOnly: z.boolean().default(true),
  perSessionExecutionConsent: z.boolean().default(false),
  disclaimerAccepted: z.boolean().default(false),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  executorEnabled: z.boolean().default(false)
})

export type AppSettings = z.infer<typeof SettingsSchema>

export const SimulationRunRequestSchema = z.object({
  strategyConfig: StrategyConfigSchema,
  seed: z.number().int(),
  spinCount: z.number().int().positive().max(1_000_000),
  initialBankroll: z.number().positive(),
  batchSessions: z.number().int().positive().max(50_000).default(1)
})

export type SimulationRunRequest = z.infer<typeof SimulationRunRequestSchema>

export const SimulationHistoricalRequestSchema = z.object({
  strategyConfig: StrategyConfigSchema,
  initialBankroll: z.number().positive(),
  spins: z.array(z.number().int().min(0).max(36)).min(1)
})

export type SimulationHistoricalRequest = z.infer<typeof SimulationHistoricalRequestSchema>

export const SessionStartRequestSchema = z
  .object({
    mode: AppModeSchema,
    strategyId: z.string().optional(),
    strategyConfig: StrategyConfigSchema.optional(),
    initialBankroll: z.number().positive(),
    startUrl: z.string().url().optional(),
  /** Absolute profit (same currency as table balance) — session stops when reached. */
  takeProfit: z.number().positive().optional(),
  /** Absolute loss from session-start balance — session stops when reached. */
  maxLoss: z.number().positive().optional(),
  /**
   * When the table DOM does not expose spin numbers yet, feed this once as the last outcome (0–36)
   * so VIP / engine can place the first bet. Observer readings take over once available.
   */
  manualLastSpin: z.number().int().min(0).max(36).optional(),
  /**
   * Optional profile name for userData/teaching/mappings/<key>.json (recorded UI hints).
   * When omitted, resolution falls back to hostname+path of startUrl.
   */
  teachingMappingKey: z.string().max(120).optional()
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'observer') return
    const hasId = typeof data.strategyId === 'string' && data.strategyId.trim() !== ''
    if (!hasId && !data.strategyConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'strategyConfig or strategyId required unless mode is observer',
        path: ['strategyId']
      })
    }
  })

export type SessionStartRequest = z.infer<typeof SessionStartRequestSchema>

export const SessionConfirmPayloadSchema = z.object({
  sessionId: z.string(),
  accept: z.boolean(),
  decisionSnapshot: DecisionSchema.optional()
})

export type SessionConfirmPayload = z.infer<typeof SessionConfirmPayloadSchema>

export const FeedTableSaveRequestSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  /** Stringified JSON object with keys "0".."36", values number[5] */
  mappingJson: z.string().min(4)
})

export type FeedTableSaveRequest = z.infer<typeof FeedTableSaveRequestSchema>

export const IpcEnvelopeSchema = z.object({
  id: z.string(),
  channel: z.string(),
  payload: z.unknown()
})

export type IpcEnvelope = z.infer<typeof IpcEnvelopeSchema>
