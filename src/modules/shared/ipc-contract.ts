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

export const SessionStartRequestSchema = z.object({
  mode: AppModeSchema,
  strategyId: z.string().optional(),
  strategyConfig: StrategyConfigSchema.optional(),
  initialBankroll: z.number().positive(),
  startUrl: z.string().url().optional()
})

export type SessionStartRequest = z.infer<typeof SessionStartRequestSchema>

export const SessionConfirmPayloadSchema = z.object({
  sessionId: z.string(),
  accept: z.boolean(),
  decisionSnapshot: DecisionSchema.optional()
})

export type SessionConfirmPayload = z.infer<typeof SessionConfirmPayloadSchema>

export const IpcEnvelopeSchema = z.object({
  id: z.string(),
  channel: z.string(),
  payload: z.unknown()
})

export type IpcEnvelope = z.infer<typeof IpcEnvelopeSchema>
