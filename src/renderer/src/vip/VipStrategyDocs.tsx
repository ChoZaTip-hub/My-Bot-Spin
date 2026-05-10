import type { ReactElement } from 'react'
import { VIP_FEED_TABLE } from '@modules/vip-five/vip-feed'
import { VIP_CHIPS_PER_LEVEL, VIP_RESET_MIN_WINS_IN_LAST26 } from '@modules/vip-five/vip-progress'
import { useI18n } from '../i18n/context'

const OUTCOMES = Array.from({ length: 37 }, (_, i) => i)

export default function VipStrategyDocs(): ReactElement {
  const { t } = useI18n()

  return (
    <section className="mt-4 space-y-3 rounded-lg border border-gold/25 bg-amber-950/10 p-4 text-sm dark:bg-amber-950/20">
      <h2 className="font-display text-base font-semibold text-gold">{t('stratVipBuiltInTitle')}</h2>
      <p className="leading-relaxed text-slate-600 dark:text-slate-300">{t('stratVipBuiltInIntro')}</p>
      <div className="rounded-md border border-border/60 bg-surface/30 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {t('stratFeedSelectionDocTitle')}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{t('stratFeedSelectionDocBody')}</p>
      </div>
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('stratVipRulesDetail')}</p>
      <div className="rounded-md border border-border/80 bg-surface/40 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">{t('stratVipChipsLabel')}</div>
        <div className="mt-1 font-mono text-sm text-slate-200">
          {VIP_CHIPS_PER_LEVEL.join(' → ')} ({t('stratVipLevelsHint')})
        </div>
        <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">{t('stratVipResetHintTitle')}</div>
        <div className="mt-1 font-mono text-xs text-slate-400">
          ≥{VIP_RESET_MIN_WINS_IN_LAST26} {t('stratVipResetHintBody')}
        </div>
      </div>
      <details className="rounded-lg border border-border bg-elevated/60">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gold hover:bg-gold/5">
          {t('stratVipTableToggle')}
        </summary>
        <div className="max-h-[min(70vh,560px)] overflow-auto border-t border-border">
          <table className="w-full text-left text-[11px] font-mono">
            <thead className="sticky top-0 bg-elevated">
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-slate-500">
                <th className="p-2">{t('stratVipColLast')}</th>
                <th className="p-2">{t('stratVipColFive')}</th>
              </tr>
            </thead>
            <tbody>
              {OUTCOMES.map((o) => (
                <tr key={o} className="border-t border-border/50">
                  <td className="whitespace-nowrap p-2 align-top font-semibold text-gold">{o}</td>
                  <td className="p-2 text-slate-300">{VIP_FEED_TABLE[o]?.join(', ') ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
