import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { AppSettings } from '@modules/shared/ipc-contract'
import type { AppMode } from '@modules/shared/modes'
import { StrategyConfigSchema } from '@modules/shared/strategy-config'
import type { AppLocale } from './i18n/types'
import type { MessageKey } from './i18n/messages'
import { translate } from './i18n/messages'
import {
  BUILTIN_STRATEGY_ENTRIES,
  PRIMARY_VIP_STRATEGY_ID,
  getBuiltinStrategyConfigById
} from '@modules/shared/builtin-strategies'
import { I18nProvider, useI18n } from './i18n/context'
import CasinoDashboard from './casino/CasinoDashboard'
import AssistStandalone from './assist/AssistStandalone'
import TeachingPage from './TeachingPage'
import FeedTablesPage from './FeedTablesPage'
import VipStrategyDocs from './vip/VipStrategyDocs'
import { getApi } from './bridge'

/** Timeline `at` is stored as Unix ms internally; shown as local date + hour:minute (no seconds). */
function formatTimelineAt(ms: unknown, locale: AppLocale): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  const tag = locale === 'ru' ? 'ru-RU' : 'en-GB'
  return d.toLocaleString(tag, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function isAssistWindowRoute(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('assist') === '1') return true
  } catch {
    /* ignore */
  }
  const h = window.location.hash.trim()
  return /^#\/assist\b/.test(h) || /^#assist\b/.test(h)
}

export default function App(): React.ReactElement {
  if (isAssistWindowRoute()) {
    return <AssistStandalone />
  }
  return <MainApp />
}

type Page =
  | 'dashboard'
  | 'simple'
  | 'strategies'
  | 'feedTables'
  | 'simulator'
  | 'live'
  | 'teach'
  | 'logs'
  | 'settings'

const DEFAULT_SIMPLE_TABLE_URL = 'https://fresh.casino/table/galaxsys-roulettex'

function guessLocale(): AppLocale {
  return typeof navigator !== 'undefined' && /^ru/i.test(navigator.language) ? 'ru' : 'en'
}

function useThemeClass(settings: AppSettings | null) {
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const dark =
      settings.theme === 'dark' ||
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    root.classList.toggle('dark', dark)
  }, [settings])
}

function drawdownSeries(curve: number[]): { step: number; drawdown: number }[] {
  let peak = curve[0] ?? 0
  return curve.map((b, i) => {
    peak = Math.max(peak, b)
    return { step: i, drawdown: peak - b }
  })
}

const METRIC_LABELS: Partial<Record<string, MessageKey>> = {
  totalSessions: 'metric_totalSessions',
  winRate: 'metric_winRate',
  evEstimate: 'metric_evEstimate',
  maxDrawdownAcrossSessions: 'metric_maxDrawdownAcrossSessions',
  longestLossStreak: 'metric_longestLossStreak',
  longestWinStreak: 'metric_longestWinStreak',
  mode: 'metric_mode'
}

function MainApp(): React.ReactElement {
  const api = getApi()
  const [page, setPage] = useState<Page>('dashboard')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [strategies, setStrategies] = useState<{ id: string; name: string; updatedAt: number }[]>([])
  const [error, setError] = useState<string | null>(null)

  const strategiesForUi = useMemo(() => {
    const vipOnly = strategies.filter((s) => s.id === PRIMARY_VIP_STRATEGY_ID)
    if (vipOnly.length > 0) return vipOnly
    return BUILTIN_STRATEGY_ENTRIES.map((b) => ({ id: b.id, name: b.name, updatedAt: 0 }))
  }, [strategies])

  const refreshStrategies = useCallback(async () => {
    const list = await api.strategies.list()
    setStrategies(list)
  }, [api])

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.settings.get()
        setSettings(s)
        await refreshStrategies()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [api, refreshStrategies])

  useThemeClass(settings)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        void api.session.resume().catch(() => undefined)
      }
      if (mod && e.key === '.') {
        e.preventDefault()
        void api.session.stop().catch(() => undefined)
      }
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        void api.session.pause().catch(() => undefined)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api])

  const onLocaleChange = useCallback(
    async (locale: AppLocale) => {
      const next = await api.settings.set({ locale })
      setSettings(next)
    },
    [api]
  )

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <p className="text-sm text-slate-500">{translate(guessLocale(), 'loading')}</p>
      </div>
    )
  }

  return (
    <I18nProvider locale={settings.locale} onLocaleChange={onLocaleChange}>
      <AppChrome
        page={page}
        setPage={setPage}
        settings={settings}
        setSettings={setSettings}
        strategies={strategiesForUi}
        error={error}
        api={api}
        refreshStrategies={refreshStrategies}
      />
    </I18nProvider>
  )
}

function AppChrome(props: {
  page: Page
  setPage: (p: Page) => void
  settings: AppSettings
  setSettings: (s: AppSettings) => void
  strategies: { id: string; name: string; updatedAt: number }[]
  error: string | null
  api: ReturnType<typeof getApi>
  refreshStrategies: () => Promise<void>
}): React.ReactElement {
  const { t, locale, setLocale } = useI18n()
  const { page, setPage, settings, setSettings, strategies, error, api, refreshStrategies } = props

  const acceptDisclaimer = async () => {
    const next = await api.settings.set({ disclaimerAccepted: true })
    setSettings(next)
  }

  const navItems: [Page, MessageKey][] = [
    ['dashboard', 'navDashboard'],
    ['simple', 'navSimple'],
    ['strategies', 'navStrategies'],
    ['feedTables', 'navFeedTables'],
    ['simulator', 'navSimulator'],
    ['live', 'navLive'],
    ['teach', 'navTeach'],
    ['logs', 'navLogs'],
    ['settings', 'navSettings']
  ]

  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)

  useEffect(() => {
    const tick = (): void => {
      void props.api.session.status().then((s) => setLiveSessionId(s.sessionId))
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => clearInterval(id)
  }, [props.api])

  return (
    <div className="casino-ui flex h-screen flex-col bg-surface text-slate-900 dark:text-slate-100">
      {!settings.disclaimerAccepted && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disc-title"
        >
          <div className="max-w-lg rounded-lg border border-border bg-elevated p-6 shadow-xl">
            <h2 id="disc-title" className="text-lg font-semibold">
              {t('riskNotice')}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t('riskBody')}</p>
            <button
              type="button"
              className="mt-6 w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-accent"
              onClick={() => void acceptDisclaimer()}
            >
              {t('understand')}
            </button>
          </div>
        </div>
      )}

      <header className="flex items-center justify-between border-b border-border/80 bg-elevated/95 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="bg-gradient-to-r from-gold to-amber-200 bg-clip-text font-display text-base font-bold tracking-tight text-transparent">
            {t('appTitle')}
          </span>
          <span className="rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
            {t('badgeLocal')}
          </span>
          {liveSessionId && (
            <span className="rounded-full bg-blue-600 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-widest text-white shadow-lg shadow-blue-900/50">
              {t('liveBadge')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            className="rounded-md border border-gold/40 bg-surface px-2.5 py-1 text-xs font-medium text-gold hover:bg-gold/10"
            onClick={() => void props.api.assist.open().catch(() => undefined)}
          >
            {t('navAssist')}
          </button>
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface px-1 py-0.5">
            <span className="px-1 text-xs text-slate-500">{t('langSwitch')}:</span>
            <button
              type="button"
              className={`rounded px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-accent ${
                locale === 'en' ? 'bg-slate-200 dark:bg-slate-700' : 'hover:bg-slate-100 dark:hover:bg-slate-900'
              }`}
              onClick={() => void setLocale('en')}
              aria-pressed={locale === 'en'}
            >
              EN
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-accent ${
                locale === 'ru' ? 'bg-slate-200 dark:bg-slate-700' : 'hover:bg-slate-100 dark:hover:bg-slate-900'
              }`}
              onClick={() => void setLocale('ru')}
              aria-pressed={locale === 'ru'}
            >
              RU
            </button>
          </div>
          <div className="text-xs text-slate-500">
            {settings.dryRunOnly ? t('headerDryRunOnly') : t('headerExecMay')} · {t('headerTheme')}: {settings.theme}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-row">
        <nav
          className="w-52 shrink-0 border-r border-border/80 bg-elevated/90 p-3 backdrop-blur-sm"
          aria-label={t('navMain')}
        >
          {navItems.map(([id, key]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              className={`mb-1 flex w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-gold/50 ${
                page === id
                  ? 'bg-gold/10 text-gold ring-1 ring-gold/30'
                  : 'text-slate-700 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-800/80'
              }`}
            >
              {t(key)}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
          {/* Top strip: must match BrowserView bounds (see table-embed UPPER_EMBED_HEIGHT_RATIO ≈ flex 14/(14+11)) */}
          <div className="relative flex min-h-0 flex-[14] flex-col border-b border-border/80 bg-gradient-to-br from-slate-950 via-slate-900 to-black">
            <div className="pointer-events-none flex min-h-0 flex-1 flex-col items-center justify-center p-4 text-center">
              <p className="max-w-md text-xs leading-relaxed text-slate-500">{t('embedTableHint')}</p>
            </div>
          </div>

          <main className="min-h-0 flex-[11] overflow-auto p-5">
            {error && (
              <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-danger dark:border-red-900 dark:bg-red-950">
                {error}
              </div>
            )}
            {page === 'dashboard' && <CasinoDashboard strategies={strategies} />}
            {page === 'simple' && (
              <SimpleLaunchPage
                api={api}
                strategies={strategies}
                settings={settings}
                setSettings={setSettings}
              />
            )}
            {page === 'strategies' && (
              <StrategiesPage
                api={api}
                strategies={strategies}
                onRefresh={() => void refreshStrategies()}
              />
            )}
            {page === 'feedTables' && <FeedTablesPage api={api} />}
            {page === 'simulator' && (
              <SimulatorPage api={api} strategies={strategies} metricLabels={METRIC_LABELS} />
            )}
            {page === 'live' && (
              <LivePage api={api} strategies={strategies} settings={settings} setSettings={setSettings} />
            )}
            {page === 'teach' && <TeachingPage api={api} />}
            {page === 'logs' && <LogsPage api={api} />}
            {page === 'settings' && (
              <SettingsPage
                settings={settings}
                onChange={async (partial) => {
                  const next = await api.settings.set(partial)
                  setSettings(next)
                }}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

function SimpleLaunchPage(props: {
  api: ReturnType<typeof getApi>
  strategies: { id: string; name: string }[]
  settings: AppSettings
  setSettings: (s: AppSettings) => void
}): React.ReactElement {
  const { t, locale } = useI18n()
  const [strategyId, setStrategyId] = useState('')
  const [url, setUrl] = useState(DEFAULT_SIMPLE_TABLE_URL)
  const [bankroll, setBankroll] = useState('1000')
  const [takeProfit, setTakeProfit] = useState('')
  const [maxLoss, setMaxLoss] = useState('')
  const [observeOnly, setObserveOnly] = useState(false)
  const [manualLastSpin, setManualLastSpin] = useState('')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<unknown[]>([])
  const [pending, setPending] = useState<unknown>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [teachingMappingKey, setTeachingMappingKey] = useState('')

  useEffect(() => {
    const off = props.api.onTimeline((ev) => {
      setTimeline((prev) => [...prev, ev])
    })
    return off
  }, [props.api])

  useEffect(() => {
    if (props.strategies.length === 1 && strategyId === '') {
      setStrategyId(props.strategies[0]!.id)
    }
  }, [props.strategies, strategyId])

  const refreshStatus = async () => {
    const s = await props.api.session.status()
    setPending(s.pending)
    setSessionId(s.sessionId)
  }

  const onStart = async (): Promise<void> => {
    setSessionError(null)
    if (!observeOnly && !strategyId.trim()) {
      setSessionError(t('liveStrategyRequired'))
      return
    }
    const br = Number.parseFloat(bankroll)
    if (!Number.isFinite(br) || br <= 0) {
      setSessionError(t('liveBankrollInvalid'))
      return
    }
    const tpRaw = takeProfit.trim()
    const mlRaw = maxLoss.trim()
    const tp = tpRaw ? Number.parseFloat(tpRaw) : undefined
    const ml = mlRaw ? Number.parseFloat(mlRaw) : undefined
    if (tpRaw && (!Number.isFinite(tp) || (tp ?? 0) <= 0)) {
      setSessionError(t('liveBankrollInvalid'))
      return
    }
    if (mlRaw && (!Number.isFinite(ml) || (ml ?? 0) <= 0)) {
      setSessionError(t('liveBankrollInvalid'))
      return
    }
    const msRaw = manualLastSpin.trim()
    let manualSpinOpt: number | undefined
    if (msRaw !== '') {
      const mn = Number.parseInt(msRaw, 10)
      if (!Number.isInteger(mn) || mn < 0 || mn > 36) {
        setSessionError(t('manualSpinInvalid'))
        return
      }
      manualSpinOpt = mn
    }
    try {
      if (observeOnly) {
        const next = await props.api.settings.set({ dryRunOnly: true })
        props.setSettings(next)
      } else {
        const next = await props.api.settings.set({
          dryRunOnly: false,
          executorEnabled: true,
          perSessionExecutionConsent: true
        })
        props.setSettings(next)
      }
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e))
      return
    }

    setTimeline([])
    try {
      await props.api.session.start({
        mode: observeOnly ? 'observer' : 'confirmed-action',
        ...(strategyId.trim() ? { strategyId: strategyId.trim() } : {}),
        initialBankroll: br,
        startUrl: url.trim() ? url.trim() : undefined,
        ...(tp != null && Number.isFinite(tp) && tp > 0 ? { takeProfit: tp } : {}),
        ...(ml != null && Number.isFinite(ml) && ml > 0 ? { maxLoss: ml } : {}),
        ...(manualSpinOpt !== undefined ? { manualLastSpin: manualSpinOpt } : {}),
        ...(teachingMappingKey.trim() ? { teachingMappingKey: teachingMappingKey.trim() } : {})
      })
      await refreshStatus()
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold text-gold">{t('simpleTitle')}</h1>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('simpleIntro')}</p>
      <p className="text-xs text-slate-500">{t('simpleProfitHint')}</p>
      {sessionError && (
        <div
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-danger dark:border-red-900 dark:bg-red-950"
          role="alert"
        >
          {sessionError}
        </div>
      )}
      <div className="grid max-w-xl gap-3 rounded-lg border border-border bg-elevated p-4">
        <label className="block text-sm">
          <span className="text-xs uppercase text-slate-500">{t('simpleStrategy')}</span>
          <select
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm"
            value={strategyId}
            onChange={(e) => void setStrategyId(e.target.value)}
          >
            <option value="">{t('simSelect')}</option>
            {props.strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs uppercase text-slate-500">{t('simpleUrl')}</span>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm font-mono"
            value={url}
            onChange={(e) => void setUrl(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs uppercase text-slate-500">{t('sessionMappingKey')}</span>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm font-mono"
            value={teachingMappingKey}
            onChange={(e) => void setTeachingMappingKey(e.target.value)}
            placeholder={t('sessionMappingKeyPh')}
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs uppercase text-slate-500">{t('simpleBankroll')}</span>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm"
            value={bankroll}
            onChange={(e) => void setBankroll(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs uppercase text-slate-500">{t('simpleTakeProfit')}</span>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm"
            placeholder={t('simpleTakeProfitPh')}
            value={takeProfit}
            onChange={(e) => void setTakeProfit(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs uppercase text-slate-500">{t('simpleMaxLoss')}</span>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm"
            placeholder={t('simpleMaxLossPh')}
            value={maxLoss}
            onChange={(e) => void setMaxLoss(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs uppercase text-slate-500">{t('simpleManualLastSpin')}</span>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm"
            inputMode="numeric"
            placeholder={t('simpleManualLastSpinPh')}
            value={manualLastSpin}
            onChange={(e) => void setManualLastSpin(e.target.value)}
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={observeOnly}
            onChange={(e) => void setObserveOnly(e.target.checked)}
          />
          {t('simpleObserveOnly')}
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-white"
          onClick={() => void onStart()}
        >
          {t('start')}
        </button>
        <button
          type="button"
          className="rounded bg-slate-200 px-3 py-2 text-sm dark:bg-slate-800"
          onClick={() => void props.api.session.pause()}
        >
          {t('pause')}
        </button>
        <button
          type="button"
          className="rounded bg-slate-200 px-3 py-2 text-sm dark:bg-slate-800"
          onClick={() => void props.api.session.resume()}
        >
          {t('resume')}
        </button>
        <button
          type="button"
          className="rounded bg-red-700 px-3 py-2 text-sm text-white"
          onClick={() => void props.api.session.stop()}
        >
          {t('stop')}
        </button>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void refreshStatus()}>
          {t('refreshStatus')}
        </button>
      </div>

      {Boolean(pending) &&
        props.settings.executorEnabled &&
        !props.settings.dryRunOnly &&
        !observeOnly && (
          <div className="mt-4 rounded border border-amber-500 bg-amber-50 p-4 text-sm dark:bg-amber-950">
            <div className="font-medium">{t('confirmRequired')}</div>
            <pre className="mt-2 max-h-40 overflow-auto text-xs">{JSON.stringify(pending, null, 2)}</pre>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded bg-emerald-600 px-3 py-2 text-white"
                onClick={() =>
                  void props.api.session
                    .confirm({ sessionId: sessionId ?? 'unknown', accept: true })
                    .then(refreshStatus)
                }
              >
                {t('confirmAction')}
              </button>
              <button
                type="button"
                className="rounded bg-slate-300 px-3 py-2 dark:bg-slate-700"
                onClick={() =>
                  void props.api.session
                    .confirm({ sessionId: sessionId ?? 'unknown', accept: false })
                    .then(refreshStatus)
                }
              >
                {t('decline')}
              </button>
            </div>
          </div>
        )}

      <div className="mt-6">
        <h2 className="text-sm font-semibold">{t('timelineTitle')}</h2>
        <div className="mt-2 max-h-[420px] overflow-auto rounded border border-border bg-elevated">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-elevated">
              <tr>
                <th className="p-2">{t('colTime')}</th>
                <th className="p-2">{t('colKind')}</th>
                <th className="p-2">{t('colPayload')}</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((row, i) => {
                const r = row as { at?: number; kind?: string; payload?: unknown }
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2 font-mono text-[11px]">{formatTimelineAt(r.at, locale)}</td>
                    <td className="p-2">{r.kind}</td>
                    <td className="p-2 font-mono">{JSON.stringify(r.payload)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StrategiesPage(props: {
  api: ReturnType<typeof getApi>
  strategies: { id: string; name: string }[]
  onRefresh: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [json, setJson] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const presetList =
    props.strategies.length > 0
      ? props.strategies
      : BUILTIN_STRATEGY_ENTRIES.map((b) => ({ id: b.id, name: b.name }))

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const fromDb = await props.api.strategies.get(PRIMARY_VIP_STRATEGY_ID)
        const cfg = fromDb ?? getBuiltinStrategyConfigById(PRIMARY_VIP_STRATEGY_ID)
        if (cfg != null && !cancelled) {
          setJson(JSON.stringify(cfg, null, 2))
        }
      } catch {
        const builtin = getBuiltinStrategyConfigById(PRIMARY_VIP_STRATEGY_ID)
        if (builtin != null && !cancelled) {
          setJson(JSON.stringify(builtin, null, 2))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [props.api])

  return (
    <div>
      <h1 className="text-xl font-semibold">{t('stratTitle')}</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t('stratIntro')}</p>
      <p className="mt-2 rounded-md border border-border/80 bg-surface/60 px-3 py-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {t('stratSectionExplain')}
      </p>
      <VipStrategyDocs />
      <div className="mt-4 flex flex-wrap gap-2">
        {presetList.map((s) => (
          <button
            key={s.id}
            type="button"
            className="rounded border border-border px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-900"
            onClick={async () => {
              setFeedback(null)
              try {
                const fromDb = await props.api.strategies.get(s.id)
                const cfg = fromDb ?? getBuiltinStrategyConfigById(s.id)
                if (cfg == null) {
                  setFeedback({ kind: 'error', text: t('stratLoadFailed') })
                  return
                }
                setJson(JSON.stringify(cfg, null, 2))
              } catch (e) {
                const builtin = getBuiltinStrategyConfigById(s.id)
                if (builtin != null) {
                  setJson(JSON.stringify(builtin, null, 2))
                  setFeedback(null)
                } else {
                  setFeedback({
                    kind: 'error',
                    text: e instanceof Error ? e.message : String(e)
                  })
                }
              }
            }}
          >
            {s.name}
          </button>
        ))}
      </div>
      <textarea
        className="mt-4 h-80 w-full rounded border border-border bg-elevated p-3 font-mono text-xs"
        spellCheck={false}
        value={json}
        onChange={(e) => setJson(e.target.value)}
        placeholder={t('stratPlaceholder')}
      />
      {feedback && (
        <pre
          className={`mt-2 max-h-40 overflow-auto rounded p-2 text-xs ${
            feedback.kind === 'error'
              ? 'bg-red-50 text-danger dark:bg-red-950'
              : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
          }`}
        >
          {feedback.text}
        </pre>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded bg-slate-200 px-3 py-2 text-sm dark:bg-slate-800"
          onClick={async () => {
            try {
              const trimmed = json.trim()
              if (!trimmed) {
                setFeedback({ kind: 'error', text: t('stratEmpty') })
                return
              }
              const parsed = JSON.parse(trimmed) as unknown
              const r = await props.api.strategies.validate(parsed)
              if (r.ok) {
                setFeedback(null)
              } else {
                setFeedback({ kind: 'error', text: JSON.stringify(r.errors, null, 2) })
              }
            } catch (e) {
              setFeedback({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
            }
          }}
        >
          {t('validate')}
        </button>
        <button
          type="button"
          className="rounded bg-accent px-3 py-2 text-sm text-white"
          onClick={async () => {
            setFeedback(null)
            try {
              const trimmed = json.trim()
              if (!trimmed) {
                setFeedback({ kind: 'error', text: t('stratEmpty') })
                return
              }
              const parsed = JSON.parse(trimmed) as unknown
              await props.api.strategies.save(parsed)
              props.onRefresh()
              setFeedback({ kind: 'success', text: t('stratSaved') })
            } catch (e) {
              setFeedback({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
            }
          }}
        >
          {t('save')}
        </button>
      </div>
    </div>
  )
}

function SimulatorPage(props: {
  api: ReturnType<typeof getApi>
  strategies: { id: string; name: string }[]
  metricLabels: Partial<Record<string, MessageKey>>
}): React.ReactElement {
  const { t } = useI18n()
  const [strategyId, setStrategyId] = useState<string>('')
  const [seed, setSeed] = useState('42')
  const [spins, setSpins] = useState('500')
  const [bankroll, setBankroll] = useState('1000')
  const [batch, setBatch] = useState('20')
  const [curve, setCurve] = useState<number[]>([])
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null)
  const [histSpins, setHistSpins] = useState<number[]>([])

  useEffect(() => {
    if (props.strategies.length === 1 && strategyId === '') {
      setStrategyId(props.strategies[0]!.id)
    }
  }, [props.strategies, strategyId])

  const chartData = useMemo(() => {
    const dd = drawdownSeries(curve)
    return curve.map((b, i) => ({
      step: i,
      bankroll: b,
      drawdown: dd[i]?.drawdown ?? 0
    }))
  }, [curve])

  const metricTitle = (key: string): string => {
    const mk = props.metricLabels[key]
    return mk ? t(mk) : key
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">{t('simTitle')}</h1>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded border border-border bg-elevated p-4">
          <label className="text-xs font-medium text-slate-500">{t('simStrategy')}</label>
          <select
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm"
            value={strategyId}
            onChange={(e) => void setStrategyId(e.target.value)}
          >
            <option value="">{t('simSelect')}</option>
            {props.strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="mt-3 block text-xs font-medium text-slate-500">{t('simSeed')}</label>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
          <label className="mt-3 block text-xs font-medium text-slate-500">{t('simSpins')}</label>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm"
            value={spins}
            onChange={(e) => setSpins(e.target.value)}
          />
          <label className="mt-3 block text-xs font-medium text-slate-500">{t('simBankroll')}</label>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm"
            value={bankroll}
            onChange={(e) => setBankroll(e.target.value)}
          />
          <label className="mt-3 block text-xs font-medium text-slate-500">{t('simBatch')}</label>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
          />
          <button
            type="button"
            className="mt-4 w-full rounded bg-accent py-2 text-sm font-medium text-white"
            onClick={async () => {
              const cfgUnknown = await props.api.strategies.get(strategyId)
              const cfg = StrategyConfigSchema.parse(cfgUnknown)
              const res = (await props.api.simulation.run({
                strategyConfig: cfg,
                seed: Number.parseInt(seed, 10),
                spinCount: Number.parseInt(spins, 10),
                initialBankroll: Number.parseFloat(bankroll),
                batchSessions: Number.parseInt(batch, 10)
              })) as { lastCurve: number[]; metrics: Record<string, unknown> }
              setCurve(res.lastCurve)
              setMetrics(res.metrics)
              try {
                sessionStorage.setItem('rsa_last_curve', JSON.stringify(res.lastCurve))
              } catch {
                /* ignore */
              }
            }}
          >
            {t('simRunMc')}
          </button>
        </div>
        <div className="rounded border border-border bg-elevated p-4">
          <h2 className="text-sm font-semibold">{t('simHistTitle')}</h2>
          <button
            type="button"
            className="mt-2 rounded border border-border px-3 py-2 text-sm"
            onClick={async () => {
              const path = await props.api.dialog.pickCsv()
              if (!path) return
              const { spins: s } = await props.api.import.spinsCsv(path)
              setHistSpins(s)
            }}
          >
            {t('simPickCsv')}
          </button>
          <p className="mt-2 text-xs text-slate-500">
            {histSpins.length} {t('simSpinsLoaded')}
          </p>
          <button
            type="button"
            className="mt-4 w-full rounded bg-slate-800 py-2 text-sm font-medium text-white dark:bg-slate-200 dark:text-slate-900"
            onClick={async () => {
              const cfgUnknown = await props.api.strategies.get(strategyId)
              const cfg = StrategyConfigSchema.parse(cfgUnknown)
              const res = (await props.api.simulation.runHistorical({
                strategyConfig: cfg,
                initialBankroll: Number.parseFloat(bankroll),
                spins: histSpins
              })) as { bankrollCurve: number[] }
              setCurve(res.bankrollCurve)
              setMetrics({ mode: 'historical' })
              try {
                sessionStorage.setItem('rsa_last_curve', JSON.stringify(res.bankrollCurve))
              } catch {
                /* ignore */
              }
            }}
          >
            {t('simReplay')}
          </button>
        </div>
      </div>

      {metrics && (
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {Object.entries(metrics)
            .filter(([k]) => k !== 'endingBankrollDistribution')
            .map(([k, v]) => (
              <div key={k} className="rounded border border-border bg-elevated p-3 text-sm">
                <div className="text-xs uppercase text-slate-500">{metricTitle(k)}</div>
                <div className="mt-1 font-mono text-lg">{typeof v === 'number' ? v.toFixed(4) : String(v)}</div>
              </div>
            ))}
        </div>
      )}

      {chartData.length > 0 && (
        <div className="mt-8 h-72 rounded border border-border bg-elevated p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
              <XAxis dataKey="step" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="bankroll"
                name={t('chartBankroll')}
                stroke="var(--profit)"
                dot={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="drawdown"
                name={t('chartDrawdown')}
                stroke="var(--danger)"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function LivePage(props: {
  api: ReturnType<typeof getApi>
  strategies: { id: string; name: string }[]
  settings: AppSettings
  setSettings: (s: AppSettings) => void
}): React.ReactElement {
  const { t, locale } = useI18n()
  const [mode, setMode] = useState<AppMode>('dry-run')
  const [strategyId, setStrategyId] = useState('')
  const [url, setUrl] = useState('')
  const [bankroll, setBankroll] = useState('1000')
  const [manualLastSpin, setManualLastSpin] = useState('')
  const [timeline, setTimeline] = useState<unknown[]>([])
  const [pending, setPending] = useState<unknown>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [teachingMappingKey, setTeachingMappingKey] = useState('')

  useEffect(() => {
    const off = props.api.onTimeline((ev) => {
      setTimeline((prev) => [...prev, ev])
    })
    return off
  }, [props.api])

  useEffect(() => {
    if (props.strategies.length === 1 && strategyId === '') {
      setStrategyId(props.strategies[0]!.id)
    }
  }, [props.strategies, strategyId])

  const refreshStatus = async () => {
    const s = await props.api.session.status()
    setPending(s.pending)
    setSessionId(s.sessionId)
  }

  const parseOptionalManualSpin = (): number | undefined => {
    const msRaw = manualLastSpin.trim()
    if (msRaw === '') return undefined
    const mn = Number.parseInt(msRaw, 10)
    if (!Number.isInteger(mn) || mn < 0 || mn > 36) {
      setSessionError(t('manualSpinInvalid'))
      return undefined
    }
    return mn
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold text-gold">{t('liveTitle')}</h1>
      {sessionError && (
        <div
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-danger dark:border-red-900 dark:bg-red-950"
          role="alert"
        >
          {sessionError}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => setMode('observer')}
          className={`rounded-xl border-2 p-4 text-left transition-all ${
            mode === 'observer'
              ? 'border-sky-500/80 bg-sky-950/30 ring-1 ring-sky-500/40'
              : 'border-border/60 bg-elevated/60 hover:border-sky-500/30'
          }`}
        >
          <div className="font-display text-lg font-semibold text-sky-400">{t('presetObserver')}</div>
          <div className="mt-1 text-xs text-slate-400">{t('presetObserverSub')}</div>
        </button>
        <button
          type="button"
          onClick={() => setMode('suggestion')}
          className={`rounded-xl border-2 p-4 text-left transition-all ${
            mode === 'suggestion'
              ? 'border-emerald-500/80 bg-emerald-950/40 ring-1 ring-emerald-500/40'
              : 'border-border/60 bg-elevated/60 hover:border-emerald-500/30'
          }`}
        >
          <div className="font-display text-lg font-semibold text-emerald-400">{t('presetMild')}</div>
          <div className="mt-1 text-xs text-slate-400">{t('presetMildSub')}</div>
        </button>
        <button
          type="button"
          onClick={() => setMode('dry-run')}
          className={`rounded-xl border-2 p-4 text-left transition-all ${
            mode === 'dry-run'
              ? 'border-gold/80 bg-amber-950/30 ring-1 ring-gold/30'
              : 'border-border/60 bg-elevated/60 hover:border-gold/30'
          }`}
        >
          <div className="font-display text-lg font-semibold text-gold">{t('presetClassic')}</div>
          <div className="mt-1 text-xs text-slate-400">{t('presetClassicSub')}</div>
        </button>
        <button
          type="button"
          onClick={() => setMode('confirmed-action')}
          className={`rounded-xl border-2 p-4 text-left transition-all ${
            mode === 'confirmed-action'
              ? 'border-red-500/80 bg-red-950/30 ring-1 ring-red-500/40'
              : 'border-border/60 bg-elevated/60 hover:border-red-500/30'
          }`}
        >
          <div className="font-display text-lg font-semibold text-red-400">{t('presetHedge')}</div>
          <div className="mt-1 text-xs text-slate-400">{t('presetHedgeSub')}</div>
        </button>
      </div>
      {mode === 'observer' && (
        <p className="text-sm text-sky-700 dark:text-sky-300">{t('liveObserverHint')}</p>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-elevated/50 px-4 py-2 text-sm">
        <span className="text-slate-400">{t('autoBet')}</span>
        <span
          className={
            props.settings.executorEnabled && !props.settings.dryRunOnly ? 'font-mono text-profit' : 'text-slate-500'
          }
        >
          {props.settings.executorEnabled && !props.settings.dryRunOnly ? t('autoBetOn') : t('autoBetOff')}
        </span>
        <span className="text-xs text-slate-500">({t('setExecutor')})</span>
      </div>
      <div className="flex flex-wrap gap-3">
        <select
          className="rounded-lg border border-border bg-elevated px-2 py-2 text-sm text-slate-100"
          value={mode}
          onChange={(e) => setMode(e.target.value as AppMode)}
        >
          <option value="observer">{t('modeOptObserver')}</option>
          <option value="dry-run">{t('modeOptDryRun')}</option>
          <option value="suggestion">{t('modeOptSuggestion')}</option>
          <option value="confirmed-action">{t('modeOptConfirmed')}</option>
          <option value="simulation">{t('modeOptSimulation')}</option>
        </select>
        <select
          className="rounded border border-border bg-elevated px-2 py-2 text-sm"
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
        >
          <option value="">{t('liveStrategy')}</option>
          {props.strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          className="min-w-[240px] flex-1 rounded border border-border bg-elevated px-2 py-2 text-sm"
          placeholder={t('liveUrlPh')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="min-w-[140px] flex-1 rounded border border-border bg-elevated px-2 py-2 font-mono text-sm"
          placeholder={t('sessionMappingKeyPh')}
          title={t('sessionMappingKey')}
          value={teachingMappingKey}
          onChange={(e) => setTeachingMappingKey(e.target.value)}
        />
        <input
          className="w-28 rounded border border-border bg-elevated px-2 py-2 text-sm"
          value={bankroll}
          onChange={(e) => setBankroll(e.target.value)}
        />
        <input
          className="w-20 rounded border border-border bg-elevated px-2 py-2 text-sm"
          inputMode="numeric"
          placeholder={t('simpleManualLastSpinPh')}
          title={t('simpleManualLastSpin')}
          value={manualLastSpin}
          onChange={(e) => setManualLastSpin(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-accent px-3 py-2 text-sm text-white"
          onClick={async () => {
            setSessionError(null)
            if (mode !== 'observer' && !strategyId.trim()) {
              setSessionError(t('liveStrategyRequired'))
              return
            }
            const br = Number.parseFloat(bankroll)
            if (!Number.isFinite(br) || br <= 0) {
              setSessionError(t('liveBankrollInvalid'))
              return
            }
            const manualOpt = parseOptionalManualSpin()
            if (manualOpt === undefined && manualLastSpin.trim() !== '') return
            setTimeline([])
            try {
              if (mode === 'observer') {
                const next = await props.api.settings.set({ dryRunOnly: true })
                props.setSettings(next)
              }
              await props.api.session.start({
                mode,
                ...(strategyId.trim() ? { strategyId: strategyId.trim() } : {}),
                initialBankroll: br,
                startUrl: url.trim() ? url.trim() : undefined,
                ...(manualOpt !== undefined ? { manualLastSpin: manualOpt } : {}),
                ...(teachingMappingKey.trim() ? { teachingMappingKey: teachingMappingKey.trim() } : {})
              })
              await refreshStatus()
            } catch (e) {
              setSessionError(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          {t('start')}
        </button>
        <button
          type="button"
          className="rounded bg-slate-200 px-3 py-2 text-sm dark:bg-slate-800"
          onClick={() => void props.api.session.pause()}
        >
          {t('pause')}
        </button>
        <button
          type="button"
          className="rounded bg-slate-200 px-3 py-2 text-sm dark:bg-slate-800"
          onClick={() => void props.api.session.resume()}
        >
          {t('resume')}
        </button>
        <button
          type="button"
          className="rounded bg-red-700 px-3 py-2 text-sm text-white"
          onClick={() => void props.api.session.stop()}
        >
          {t('stop')}
        </button>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void refreshStatus()}>
          {t('refreshStatus')}
        </button>
      </div>

      {Boolean(pending) &&
        props.settings.executorEnabled &&
        !props.settings.dryRunOnly &&
        mode === 'confirmed-action' && (
          <div className="mt-4 rounded border border-amber-500 bg-amber-50 p-4 text-sm dark:bg-amber-950">
            <div className="font-medium">{t('confirmRequired')}</div>
            <pre className="mt-2 max-h-40 overflow-auto text-xs">{JSON.stringify(pending, null, 2)}</pre>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded bg-emerald-600 px-3 py-2 text-white"
                onClick={() =>
                  void props.api.session
                    .confirm({ sessionId: sessionId ?? 'unknown', accept: true })
                    .then(refreshStatus)
                }
              >
                {t('confirmAction')}
              </button>
              <button
                type="button"
                className="rounded bg-slate-300 px-3 py-2 dark:bg-slate-700"
                onClick={() =>
                  void props.api.session
                    .confirm({ sessionId: sessionId ?? 'unknown', accept: false })
                    .then(refreshStatus)
                }
              >
                {t('decline')}
              </button>
            </div>
          </div>
        )}

      <div className="mt-6">
        <h2 className="text-sm font-semibold">{t('timelineTitle')}</h2>
        <div className="mt-2 max-h-[420px] overflow-auto rounded border border-border bg-elevated">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-elevated">
              <tr>
                <th className="p-2">{t('colTime')}</th>
                <th className="p-2">{t('colKind')}</th>
                <th className="p-2">{t('colPayload')}</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((row, i) => {
                const r = row as { at?: number; kind?: string; payload?: unknown }
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2 font-mono text-[11px]">{formatTimelineAt(r.at, locale)}</td>
                    <td className="p-2">{r.kind}</td>
                    <td className="p-2 font-mono">{JSON.stringify(r.payload)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function LogsPage(props: { api: ReturnType<typeof getApi> }): React.ReactElement {
  const { t } = useI18n()
  const [rows, setRows] = useState<{ id: string; level: string; message: string; at: number }[]>([])
  const [filter, setFilter] = useState('')

  const load = async () => {
    const r = await props.api.logs.query({ limit: 200 })
    setRows(r)
  }

  useEffect(() => {
    void load()
  }, [props.api])

  const filtered = rows.filter((r) => (filter ? r.level === filter || r.message.includes(filter) : true))

  return (
    <div>
      <h1 className="text-xl font-semibold">{t('logsTitle')}</h1>
      <div className="mt-3 flex gap-2">
        <input
          className="rounded border border-border px-2 py-2 text-sm"
          placeholder={t('logsFilterPh')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void load()}>
          {t('refresh')}
        </button>
      </div>
      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">{t('colAt')}</th>
            <th className="p-2">{t('colLevel')}</th>
            <th className="p-2">{t('colMessage')}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="p-2 font-mono text-xs">{new Date(r.at).toISOString()}</td>
              <td className="p-2">{r.level}</td>
              <td className="p-2">{r.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SettingsPage(props: {
  settings: AppSettings
  onChange: (p: Partial<AppSettings>) => Promise<void>
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <div>
      <h1 className="text-xl font-semibold">{t('settingsTitle')}</h1>
      <div className="mt-4 max-w-lg space-y-4">
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>{t('setDryRun')}</span>
          <input
            type="checkbox"
            checked={props.settings.dryRunOnly}
            onChange={(e) => void props.onChange({ dryRunOnly: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>{t('setExecutor')}</span>
          <input
            type="checkbox"
            checked={props.settings.executorEnabled}
            onChange={(e) => void props.onChange({ executorEnabled: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>{t('setConsent')}</span>
          <input
            type="checkbox"
            checked={props.settings.perSessionExecutionConsent}
            onChange={(e) => void props.onChange({ perSessionExecutionConsent: e.target.checked })}
          />
        </label>
        <label className="block text-sm">
          <div className="mb-1 text-xs uppercase text-slate-500">{t('setLocale')}</div>
          <select
            className="w-full rounded border border-border bg-elevated px-2 py-2"
            value={props.settings.locale}
            onChange={(e) => void props.onChange({ locale: e.target.value as AppSettings['locale'] })}
          >
            <option value="en">{t('langEn')}</option>
            <option value="ru">{t('langRu')}</option>
          </select>
        </label>
        <label className="block text-sm">
          <div className="mb-1 text-xs uppercase text-slate-500">{t('setTheme')}</div>
          <select
            className="w-full rounded border border-border bg-elevated px-2 py-2"
            value={props.settings.theme}
            onChange={(e) =>
              void props.onChange({ theme: e.target.value as AppSettings['theme'] })
            }
          >
            <option value="system">{t('themeSystem')}</option>
            <option value="light">{t('themeLight')}</option>
            <option value="dark">{t('themeDark')}</option>
          </select>
        </label>
      </div>
    </div>
  )
}
