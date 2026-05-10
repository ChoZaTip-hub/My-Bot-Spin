import { z } from 'zod'

export const AppModeSchema = z.enum([
  'simulation',
  'dry-run',
  'suggestion',
  'confirmed-action',
  'observer'
])

export type AppMode = z.infer<typeof AppModeSchema>

export const SessionLifecycleSchema = z.enum(['idle', 'running', 'paused', 'halted', 'completed'])

export type SessionLifecycle = z.infer<typeof SessionLifecycleSchema>
