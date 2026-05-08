import { z } from 'zod'

export const DecisionActionSchema = z.enum(['NO_BET', 'PREPARE_BET', 'PLACE_BET', 'HALT', 'WAIT'])

export type DecisionAction = z.infer<typeof DecisionActionSchema>

export const BetTypeSchema = z.enum([
  'red',
  'black',
  'even',
  'odd',
  'low',
  'high',
  'dozen',
  'column',
  'straight',
  'group',
  'custom_table'
])

export type BetType = z.infer<typeof BetTypeSchema>

export const BetInstructionSchema = z.object({
  betType: BetTypeSchema,
  /** Color, dozen index 1–3, column 1–3, straight number, or group key / custom table name */
  target: z.union([z.string(), z.number()]),
  amount: z.number().nonnegative(),
  sequenceIndex: z.number().int().nonnegative(),
  notes: z.string().optional()
})

export type BetInstruction = z.infer<typeof BetInstructionSchema>

export const DecisionSchema = z.object({
  action: DecisionActionSchema,
  reason: z.string(),
  stakePlan: z.array(BetInstructionSchema).optional(),
  riskFlags: z.array(z.string()),
  requiresConfirmation: z.boolean(),
  metadata: z.record(z.unknown())
})

export type Decision = z.infer<typeof DecisionSchema>

export function decisionNoBet(reason: string, riskFlags: string[] = []): Decision {
  return {
    action: 'NO_BET',
    reason,
    riskFlags,
    requiresConfirmation: false,
    metadata: {}
  }
}

export function decisionHalt(reason: string, riskFlags: string[] = []): Decision {
  return {
    action: 'HALT',
    reason,
    riskFlags,
    requiresConfirmation: false,
    metadata: {}
  }
}

export function decisionWait(reason: string, riskFlags: string[] = []): Decision {
  return {
    action: 'WAIT',
    reason,
    riskFlags,
    requiresConfirmation: false,
    metadata: {}
  }
}
