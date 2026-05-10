import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { AssistSnapshot } from '@modules/shared/assist-snapshot'
import type { RendererApi } from '../bridge'

const fmtRub = (n: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)

export default function AssistStandalone(): ReactElement {
  const api = typeof window !== 'undefined' ? (window as Window & { rsa?: RendererApi }).rsa : undefined
  const [snap, setSnap] = useState<AssistSnapshot | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('dark')
    return () => document.documentElement.classList.remove('dark')
  }, [])

  useEffect(() => {
    if (!api?.assist?.getState) {
      setLoadErr('Нет моста preload (window.rsa). Перезапустите приложение.')
      setSnap({ kind: 'idle', reason: 'no_preload' })
      return
    }
    const tick = (): void => {
      void api.assist
        .getState()
        .then((s) => {
          setLoadErr(null)
          setSnap(s)
        })
        .catch((e: unknown) => {
          setLoadErr(e instanceof Error ? e.message : String(e))
          setSnap({ kind: 'idle', reason: 'assist_ipc_failed' })
        })
    }
    tick()
    const id = setInterval(tick, 600)
    return () => clearInterval(id)
  }, [api])

  if (!snap) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d1117] text-sm text-slate-400">
        Загрузка…
      </div>
    )
  }

  if (snap.kind === 'idle') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0d1117] px-6 text-center">
        {loadErr && (
          <p className="max-w-sm rounded border border-amber-600/50 bg-amber-950/40 p-3 text-sm text-amber-200">
            {loadErr}
          </p>
        )}
        <p className="text-sm leading-relaxed text-slate-400">
          Нет активной сессии VIP-five. Запустите стратегию с прогрессией «vip_five» на вкладке «Быстрый старт» или «Живая
          сессия».
        </p>
        <p className="font-mono text-xs text-slate-600">assist / idle · {snap.reason ?? ''}</p>
      </div>
    )
  }

  const s = snap
  const live = !s.paused && Boolean(s.sessionId)
  const chipTiers = [1, 2, 5, 10] as const
  const tierLabel = chipTiers[s.levelIndex] ?? s.chipsPerNumber

  const showLastRound = s.roundsCompleted > 0 && s.lastSpin != null && typeof s.lastHit === 'boolean'
  const outcomeLine = showLastRound
    ? s.lastHit
      ? `WIN · #${s.lastSpin} · +${fmtRub(Math.abs(s.lastRoundMoneyDelta ?? 0))} ₽`
      : `LOSS · #${s.lastSpin} · −${fmtRub(Math.abs(s.lastRoundMoneyDelta ?? 0))} ₽`
    : null

  const totalPrimary =
    s.tablePnLMoney != null
      ? `${s.tablePnLMoney >= 0 ? '+' : ''}${fmtRub(s.tablePnLMoney)} ₽ по столу`
      : `${s.vipChipBalance >= 0 ? '+' : ''}${s.vipChipBalance} фишек (модель VIP)`
  const totalPositive =
    s.tablePnLMoney != null ? s.tablePnLMoney >= 0 : s.vipChipBalance >= 0

  return (
    <div className="flex min-h-screen flex-col bg-[#0d1117] text-slate-100">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-lg">
            🎯
          </span>
          <div>
            <div className="font-display text-base font-semibold tracking-tight text-white">{s.strategyName}</div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Assist · 5 номеров</div>
          </div>
        </div>
        {live && (
          <span className="rounded-full bg-blue-600 px-2.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-widest text-white">
            LIVE
          </span>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-4 overflow-auto px-4 py-4">
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Куда ставить</h2>
          <div className="flex flex-wrap gap-2">
            {s.betNumbers.map((n) => (
              <div
                key={n}
                className="min-w-[52px] rounded-lg border border-[#fbbf24]/35 bg-[#161b22] px-3 py-2 text-center font-mono text-lg font-semibold text-[#ffcc00]"
              >
                #{n}
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#161b22] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Прогрессия</div>
            <div className="mt-1 font-mono text-xl font-bold text-[#ffcc00]">
              ×{tierLabel} · {s.roundsCompleted}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {fmtRub(s.stakePerRoundMoney)} ₽ на раунд · фишек на номер {s.chipsPerNumber}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#161b22] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Табл. / опора</div>
            <div className="mt-1 font-mono text-xl font-bold text-white">
              №{s.feedAnchor ?? '—'}
            </div>
            <div className="mt-1 text-xs leading-snug text-slate-400">
              {s.feedAnchor != null
                ? `Якорь #${s.feedAnchor} → ставка по строке таблицы`
                : 'Стартовый набор из стратегии'}
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Исход</h2>
          {outcomeLine ? (
            <div
              className={`rounded-lg px-4 py-3 font-mono text-sm font-semibold ${
                s.lastHit ? 'bg-emerald-950/80 text-emerald-300' : 'bg-red-950/90 text-red-200'
              }`}
            >
              {outcomeLine}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/15 px-4 py-6 text-center text-sm text-slate-500">
              Ждём первый закрытый раунд…
            </div>
          )}
          <div
            className={`mt-3 text-center font-display text-lg font-bold ${
              totalPositive ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            Итог {totalPrimary}
          </div>
        </section>

        <section className="mt-auto space-y-2 border-t border-white/10 pt-4 text-[11px] leading-relaxed text-slate-500">
          <p>
            Σ ставка за раунд: {fmtRub(s.stakePerRoundMoney)} ₽ · раундов закрыто: {s.roundsCompleted}
            {s.awaitingOutcome ? ' · ждём выпадение' : ''}
          </p>
          <p>
            Каждый спин — отдельная ставка; номера подбираются по таблице относительно последнего выпавшего опорного
            номера (см. стол «Табл. / опора»).
          </p>
        </section>
      </main>

      <footer className="shrink-0 border-t border-white/10 px-4 py-2 font-mono text-[10px] text-slate-600">
        v0.1 · /assist/Five
      </footer>
    </div>
  )
}
