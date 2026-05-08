import type { Decision } from '@modules/shared/decision'

/** Extract UI chips from decision stake plan (straight numbers + text labels for other bet types). */
export function chipsFromDecision(decision: Decision): string[] {
  const plan = decision.stakePlan
  if (!plan?.length) return []
  const out: string[] = []
  for (const s of plan) {
    if (s.betType === 'straight' && typeof s.target === 'number') {
      out.push(`#${s.target}`)
    } else {
      out.push(`${s.betType}:${String(s.target)}`)
    }
  }
  return out
}

export function progressionMeta(decision: Decision): { step: number } | null {
  const m = decision.metadata as Record<string, unknown> | undefined
  const step = m?.['progressionStep']
  return typeof step === 'number' ? { step } : null
}
