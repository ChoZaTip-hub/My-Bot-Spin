import { z } from 'zod'
import { BetTypeSchema } from './decision'

/** How VIP-five picks the 0–36 → five numbers grid for the next bet. */
export const VipFeedSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin') }),
  z.object({ kind: z.literal('fixed'), tableId: z.string().min(1) }),
  z.object({
    kind: z.literal('dominant_sector'),
    voisinsTableId: z.string().min(1),
    tiersTableId: z.string().min(1),
    orphelinsTableId: z.string().min(1),
    /** Before this many wheel outcomes in the session, use built-in grid (cold start). Default 18. */
    minSpinsBeforeSwitch: z.number().int().min(5).max(500).optional()
  })
])

export type VipFeedSelection = z.infer<typeof VipFeedSelectionSchema>

/** Soft advisory notes in timeline (descriptive — does not auto-stop). */
export const VipStopHintsSchema = z.object({
  warnDominantSectorPctGte: z.number().min(0.35).max(1).optional(),
  minSpinsForDominantWarn: z.number().int().min(10).max(500).optional(),
  warnConsecutiveRoundLossesGte: z.number().int().min(2).max(50).optional()
})

export type VipStopHints = z.infer<typeof VipStopHintsSchema>

export const ProgressionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('flat'),
    /** Multiplier applied to base unit (default 1) */
    multiplier: z.number().positive().default(1)
  }),
  z.object({
    type: z.literal('sequence'),
    /** Stake multipliers per loss step; resets on win if resetOnWin */
    multipliers: z.array(z.number().positive()).min(1)
  }),
  z.object({
    type: z.literal('vip_five'),
    /** Exactly five distinct pocket numbers (European 0–36); uniqueness enforced on StrategyConfigSchema */
    numbers: z.array(z.number().int().min(0).max(36)).length(5),
    feedSelection: VipFeedSelectionSchema.optional(),
    stopHints: VipStopHintsSchema.optional()
  })
])

export type ProgressionConfig = z.infer<typeof ProgressionSchema>

export const TriggerConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always') }),
  z.object({
    kind: z.literal('after_spin_count'),
    minHistory: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal('last_spin_in'),
    /** Last result must be one of these numbers to arm betting */
    numbers: z.array(z.number().int().min(0).max(36)).min(1)
  })
])

export type TriggerCondition = z.infer<typeof TriggerConditionSchema>

export const StopRulesSchema = z.object({
  maxLossAmount: z.number().nonnegative().optional(),
  maxWinAmount: z.number().nonnegative().optional(),
  maxProgressionDepth: z.number().int().positive().optional(),
  maxConsecutiveLosses: z.number().int().positive().optional()
})

export type StopRules = z.infer<typeof StopRulesSchema>

export const BetTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('red') }),
  z.object({ kind: z.literal('black') }),
  z.object({ kind: z.literal('even') }),
  z.object({ kind: z.literal('odd') }),
  z.object({ kind: z.literal('low') }),
  z.object({ kind: z.literal('high') }),
  z.object({ kind: z.literal('dozen'), dozen: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ kind: z.literal('column'), column: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ kind: z.literal('straight'), number: z.number().int().min(0).max(36) }),
  z.object({
    kind: z.literal('group'),
    /** Named subset; resolved via customTables */
    name: z.string().min(1)
  }),
  z.object({
    kind: z.literal('custom_table'),
    tableName: z.string().min(1)
  })
])

export type BetTarget = z.infer<typeof BetTargetSchema>

export const CustomNumberTableSchema = z.object({
  name: z.string().min(1),
  numbers: z.array(z.number().int().min(0).max(36)).min(1)
})

export const StrategyConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** Logical table / wheel label */
    tableName: z.string().min(1),
    baseUnit: z.number().positive(),
    progression: ProgressionSchema,
    resetOnWin: z.boolean(),
    allowedBetTypes: z.array(BetTypeSchema).min(1),
    /** Primary betting target */
    primaryTarget: BetTargetSchema,
    /** Optional named number groups for `group` / lookups */
    customTables: z.array(CustomNumberTableSchema).default([]),
    trigger: TriggerConditionSchema,
    stopRules: StopRulesSchema.default({})
  })
  .superRefine((data, ctx) => {
    if (data.progression.type === 'vip_five') {
      if (new Set(data.progression.numbers).size !== 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'vip_five requires five distinct numbers',
          path: ['progression', 'numbers']
        })
      }
    }
  })

export type StrategyConfig = z.infer<typeof StrategyConfigSchema>

export const TableConfigSchema = z.object({
  wheel: z.literal('european'),
  label: z.string().optional()
})

export type TableConfig = z.infer<typeof TableConfigSchema>
