import type { Decision } from '@modules/shared/decision'
import { DecisionSchema } from '@modules/shared/decision'
import type { AppMode } from '@modules/shared/modes'
import type { AppSettings } from '@modules/shared/ipc-contract'
import { decideNextAction } from '@modules/strategy-engine/engine'
import type { EngineInput } from '@modules/strategy-engine/types'
import { applyRiskToDecision } from '@modules/risk-manager/manager'
import type { RiskLimits, RiskManagerInput } from '@modules/risk-manager/types'

export type PolicyContext = {
  mode: AppMode
  settings: Pick<AppSettings, 'dryRunOnly' | 'perSessionExecutionConsent' | 'executorEnabled'>
  riskInput: RiskManagerInput
  riskLimits: RiskLimits
  engineInput: EngineInput
}

function withConfirmation(decision: Decision, require: boolean): Decision {
  if (!require) return decision
  if (decision.action === 'HALT' || decision.action === 'WAIT' || decision.action === 'NO_BET') {
    return decision
  }
  return { ...decision, requiresConfirmation: true }
}

export type PolicySlice = Pick<PolicyContext, 'mode' | 'settings' | 'riskInput' | 'riskLimits'>

function applyPolicyShell(
  riskedDecision: Decision,
  ctx: Pick<PolicyContext, 'mode' | 'settings'>
): Decision {
  let d = riskedDecision

  if (ctx.settings.dryRunOnly) {
    if (d.action === 'PLACE_BET' || d.action === 'PREPARE_BET') {
      d = {
        ...d,
        action: d.action === 'PLACE_BET' ? 'PREPARE_BET' : d.action,
        reason: `${d.reason} (dry-run only: execution blocked)`,
        riskFlags: [...d.riskFlags, 'dry_run_only'],
        requiresConfirmation: false,
        metadata: { ...d.metadata, executionBlocked: true }
      }
    }
  }

  switch (ctx.mode) {
    case 'simulation':
      return DecisionSchema.parse({
        ...d,
        metadata: { ...d.metadata, policyMode: 'simulation' }
      })
    case 'dry-run': {
      if (d.action === 'PLACE_BET') {
        return DecisionSchema.parse({
          ...d,
          action: 'PREPARE_BET',
          reason: `${d.reason} [dry-run observe]`,
          requiresConfirmation: false,
          riskFlags: [...d.riskFlags, 'dry_run'],
          metadata: { ...d.metadata, policyMode: 'dry-run' }
        })
      }
      return DecisionSchema.parse({ ...d, metadata: { ...d.metadata, policyMode: 'dry-run' } })
    }
    case 'suggestion':
      return DecisionSchema.parse({
        ...d,
        action: d.action === 'PLACE_BET' ? 'PREPARE_BET' : d.action,
        reason: `${d.reason} [suggestion]`,
        requiresConfirmation: false,
        riskFlags: [...d.riskFlags, 'suggestion_mode'],
        metadata: { ...d.metadata, policyMode: 'suggestion' }
      })
    case 'confirmed-action': {
      if (!ctx.settings.executorEnabled) {
        return DecisionSchema.parse({
          ...d,
          action: d.action === 'PLACE_BET' ? 'PREPARE_BET' : d.action,
          reason: `${d.reason} [executor disabled]`,
          riskFlags: [...d.riskFlags, 'executor_disabled'],
          requiresConfirmation: false,
          metadata: { ...d.metadata, policyMode: 'confirmed-action' }
        })
      }
      const need =
        d.action === 'PLACE_BET' &&
        !ctx.settings.dryRunOnly &&
        !ctx.settings.perSessionExecutionConsent
      return DecisionSchema.parse(
        withConfirmation(
          {
            ...d,
            riskFlags: [...d.riskFlags, 'confirmed_action_mode'],
            metadata: { ...d.metadata, policyMode: 'confirmed-action' }
          },
          need
        )
      )
    }
  }
}

/**
 * Compose engine + risk + app mode into a final decision for the session layer.
 */
export function composePolicyDecision(ctx: PolicyContext): Decision {
  const rawEngine = decideNextAction(ctx.engineInput)
  const risked = applyRiskToDecision(rawEngine, ctx.riskInput, ctx.riskLimits).decision
  return applyPolicyShell(risked, ctx)
}

/** Same policy shell as {@link composePolicyDecision}, but with a pre-built decision (e.g. VIP-five). */
export function composePolicyFromRawDecision(precomputed: Decision, ctx: PolicySlice): Decision {
  const risked = applyRiskToDecision(precomputed, ctx.riskInput, ctx.riskLimits).decision
  return applyPolicyShell(risked, ctx)
}
