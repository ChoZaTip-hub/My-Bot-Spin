import { useEffect, useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'
import type { SpinAnalyticsSummary } from '@modules/shared/sector-analytics'
import { DecisionSchema } from '@modules/shared/decision'
import { isRed } from '@modules/shared/roulette'
import { useI18n } from '../i18n/context'
import { getApi } from '../bridge'
import type { MessageKey } from '../i18n/messages'
import { chipsFromDecision, progressionMeta } from './decisionTargets'

function dominantSectorKey(dom: 'voisins' | 'tiers' | 'orphelins'): MessageKey {
  if (dom === 'voisins') return 'casinoVoisins'
  if (dom === 'tiers') return 'casinoTiers'
  return 'casinoOrphelins'
}

export default function CasinoDashboard(props: {
  strategies: { id: string; name: string }[]
}): React.ReactElement {
  const { t } = useI18n()
  const api = getApi()
  const [summary, setSummary] = useState<SpinAnalyticsSummary | null>(null)
  const [recent, setRecent] = useState<number[]>([])
  const [spinTotal, setSpinTotal] = useState(0)
  const [observerSpinTotal, setObserverSpinTotal] = useState(0)
  const [chips, setChips] = useState<string[]>([])
  const [progStep, setProgStep] = useState<number | null>(null)
  const [strategyName, setStrategyName] = useState<string | null>(null)
  const [spark, setSpark] = useState<{ i: number; v: number }[]>([])

  const load = async (): Promise<void> => {
    try {
      const o = await api.analytics.overview()
      setSummary(o.summary)
      setRecent(o.recentSpinsDesc)
      setSpinTotal(o.spinTotal)
      setObserverSpinTotal(o.observerSpinTotal ?? 0)
    } catch {
      /* ignore */
    }
    try {
      const timeline = (await api.session.timeline()) as Array<{
        kind: string
        payload: Record<string, unknown>
      }>
      let lastDecision = null
      for (let i = timeline.length - 1; i >= 0; i -= 1) {
        if (timeline[i]!.kind === 'decision') {
          lastDecision = timeline[i]!.payload?.['decision']
          break
        }
      }
      if (lastDecision) {
        const dec = DecisionSchema.parse(lastDecision)
        setChips(chipsFromDecision(dec))
        const pm = progressionMeta(dec)
        setProgStep(pm?.step ?? null)
        const note = dec.stakePlan?.[0]?.notes
        setStrategyName(typeof note === 'string' ? note : null)
      } else {
        setChips([])
        setProgStep(null)
        setStrategyName(null)
      }
    } catch {
      setChips([])
    }
  }

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 4000)
    return () => clearInterval(id)
  }, [api])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('rsa_last_curve')
      if (!raw) {
        setSpark([])
        return
      }
      const arr = JSON.parse(raw) as number[]
      if (!Array.isArray(arr)) return
      const tail = arr.slice(-120)
      setSpark(tail.map((v, i) => ({ i, v })))
    } catch {
      setSpark([])
    }
  }, [])

  const dom = summary?.dominantSector

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-gold md:text-3xl">{t('navDashboard')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">{t('casinoHeroSub')}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/80 bg-elevated/90 p-5 shadow-card">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">{t('casinoDominant')}</div>
              <div className="mt-1 font-display text-3xl font-semibold text-emerald-400">
                {dom ? t(dominantSectorKey(dom)) : '—'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {t('casinoConfidence')}:{' '}
                <span className="font-mono text-slate-200">
                  {summary ? (summary.dominantSectorPct * 100).toFixed(1) : '0'}%
                </span>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>
                {t('casinoSpinsInDb')}: <span className="font-mono text-slate-300">{spinTotal}</span>
              </div>
              <div className="mt-1">
                {t('casinoObserverLearnedSpins')}:{' '}
                <span className="font-mono text-sky-400">{observerSpinTotal}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">{t('casinoSectorMix')}</div>
            {summary && summary.spinCount > 0 ? (
              <>
                <SectorBar
                  label={t('casinoVoisins')}
                  pct={summary.sectorPct.voisins}
                  className="bg-emerald-600/80"
                />
                <SectorBar label={t('casinoTiers')} pct={summary.sectorPct.tiers} className="bg-amber-500/80" />
                <SectorBar
                  label={t('casinoOrphelins')}
                  pct={summary.sectorPct.orphelins}
                  className="bg-violet-500/80"
                />
                <SectorBar label={t('casinoZero')} pct={summary.zeroPct} className="bg-slate-200/90" />
              </>
            ) : (
              <p className="text-sm text-slate-500">{t('casinoNoSpins')}</p>
            )}
          </div>

          <div className="mt-8">
            <div className="text-xs uppercase tracking-wider text-slate-500">{t('casinoTop5')}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(summary?.topNumbers ?? []).map((x) => (
                <div
                  key={x.value}
                  className="flex min-w-[5rem] flex-col rounded-lg border border-border bg-surface/80 px-3 py-2 text-center"
                >
                  <span className="font-display text-xl font-bold text-gold">#{x.value}</span>
                  <span className="text-xs text-slate-400">{(x.pct * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-border/80 bg-elevated/90 p-5 shadow-card">
            <div className="text-xs uppercase tracking-wider text-slate-500">{t('casinoWhereBet')}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {chips.length ? (
                chips.map((c) => (
                  <span
                    key={c}
                    className="rounded-md bg-gold/20 px-4 py-2 font-display text-lg font-semibold text-gold ring-1 ring-gold/40"
                  >
                    {c}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-500">{t('casinoNoStake')}</span>
              )}
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface/60 p-4">
                <div className="text-xs uppercase text-slate-500">{t('casinoProgression')}</div>
                <div className="mt-2 font-display text-3xl text-gold">{progStep ?? '—'}</div>
                <div className="mt-1 text-xs text-slate-500">{t('casinoStep')}</div>
              </div>
              <div className="rounded-lg border border-border bg-surface/60 p-4">
                <div className="text-xs uppercase text-slate-500">{t('casinoAnchor')}</div>
                <div className="mt-2 truncate text-lg font-medium text-slate-100">
                  {strategyName ?? props.strategies[0]?.name ?? '—'}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-elevated/90 p-5 shadow-card">
            <div className="text-xs uppercase tracking-wider text-slate-500">{t('casinoShadow')}</div>
            {spark.length > 0 ? (
              <div className="mt-3 h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={spark}>
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ background: '#111827', border: '1px solid #374151' }}
                      formatter={(v: number) => [v.toFixed(0), '']}
                    />
                    <Line type="monotone" dataKey="v" stroke="var(--profit)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">{t('casinoNoSimYet')}</p>
            )}
          </div>

          <div className="rounded-xl border border-border/80 bg-elevated/90 p-4 shadow-card">
            <div className="text-xs uppercase tracking-wider text-slate-500">{t('casinoLastSpins')}</div>
            <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
              {recent.map((n, idx) => (
                <SpinChip key={`${n}-${idx}`} value={n} />
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="rounded-lg border border-border/60 bg-surface/40 px-4 py-3 text-xs text-slate-500">
        <span className="font-medium text-slate-400">{t('cardShortcuts')}</span>
        <span className="mx-2">·</span>
        {t('shortcutResume')}
        <span className="mx-2">·</span>
        {t('shortcutStop')}
      </div>
    </div>
  )
}

function SectorBar(props: { label: string; pct: number; className: string }): React.ReactElement {
  const w = Math.min(100, Math.round(props.pct * 1000) / 10)
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-400">
        <span>{props.label}</span>
        <span className="font-mono">{w.toFixed(1)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full transition-all ${props.className}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

function SpinChip(props: { value: number }): React.ReactElement {
  const cls =
    props.value === 0
      ? 'border-emerald-500/60 bg-emerald-950/50 text-emerald-300'
      : isRed(props.value)
        ? 'border-red-500/50 bg-red-950/40 text-red-200'
        : 'border-slate-600 bg-slate-900 text-slate-100'
  return (
    <span className={`inline-flex min-w-[2.25rem] justify-center rounded-md border px-2 py-1 font-mono text-sm ${cls}`}>
      {props.value}
    </span>
  )
}
