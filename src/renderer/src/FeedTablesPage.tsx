import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { BUILTIN_VIP_FEED_TABLE_ID } from '@modules/shared/feed-table-mapping'
import type { RendererApi } from './bridge'
import { useI18n } from './i18n/context'

type FeedRow = { id: string; name: string; updatedAt: number }

function prettyMapping(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export default function FeedTablesPage(props: { api: RendererApi }): ReactElement {
  const { api } = props
  const { t, locale } = useI18n()
  const [rows, setRows] = useState<FeedRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formMapping, setFormMapping] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoadingList(true)
    setErr(null)
    try {
      const list = await api.feedTables.list()
      setRows(list)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingList(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const loadRow = async (id: string) => {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const row = await api.feedTables.get(id)
      if (!row) {
        setErr(t('feedTablesErrLoad'))
        return
      }
      setFormId(row.id)
      setFormName(row.name)
      setFormMapping(prettyMapping(row.mappingJson))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleNew = async () => {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const base = await api.feedTables.get(BUILTIN_VIP_FEED_TABLE_ID)
      if (!base) {
        setErr(t('feedTablesErrLoad'))
        return
      }
      setFormId('')
      setFormName('')
      setFormMapping(prettyMapping(base.mappingJson))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const idTrim = formId.trim()
      const res = await api.feedTables.save({
        id: idTrim || undefined,
        name: formName.trim(),
        mappingJson: formMapping.trim()
      })
      setFormId(res.id)
      setMsg(t('feedTablesSaved'))
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    const id = formId.trim()
    if (!id || id === BUILTIN_VIP_FEED_TABLE_ID) return
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      await api.feedTables.delete(id)
      setFormId('')
      setFormName('')
      setFormMapping('')
      setMsg(t('feedTablesDeleted'))
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const dateTag = locale === 'ru' ? 'ru-RU' : 'en-GB'

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="font-display text-xl font-semibold text-gold">{t('feedTablesTitle')}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {t('feedTablesIntro')}
        </p>
      </div>

      {msg && (
        <div className="rounded border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
          {msg}
        </div>
      )}
      {err && (
        <div className="rounded border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="lg:w-72 shrink-0 space-y-2 rounded-lg border border-border bg-elevated/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('feedTablesListLabel')}
            </span>
            <button
              type="button"
              disabled={busy || loadingList}
              className="rounded border border-border px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
              onClick={() => void refresh()}
            >
              {t('feedTablesRefresh')}
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            className="w-full rounded-md bg-gold/15 px-3 py-2 text-left text-sm font-medium text-gold ring-1 ring-gold/25 hover:bg-gold/25 disabled:opacity-50"
            onClick={() => void handleNew()}
          >
            {t('feedTablesNew')}
          </button>
          <ul className="max-h-[min(60vh,420px)] space-y-1 overflow-auto text-sm">
            {loadingList && <li className="text-slate-500">{t('loading')}</li>}
            {!loadingList &&
              rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={busy}
                    className={`flex w-full flex-col rounded px-2 py-2 text-left transition-colors disabled:opacity-50 ${
                      formId === r.id ? 'bg-gold/10 ring-1 ring-gold/30' : 'hover:bg-slate-200/80 dark:hover:bg-slate-800/80'
                    }`}
                    onClick={() => void loadRow(r.id)}
                  >
                    <span className="font-mono text-xs text-gold">{r.id}</span>
                    <span className="truncate text-slate-700 dark:text-slate-200">{r.name}</span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(r.updatedAt).toLocaleString(dateTag, {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </aside>

        <section className="min-w-0 flex-1 space-y-3 rounded-lg border border-border bg-surface/40 p-4">
          {!formId && !formName && !formMapping.trim() ? (
            <p className="text-sm text-slate-500">{t('feedTablesSelectRow')}</p>
          ) : null}

          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('feedTablesEditId')}</span>
            <input
              className="w-full rounded border border-border bg-elevated px-3 py-2 font-mono text-sm disabled:opacity-60"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              placeholder={t('feedTablesEditIdPh')}
              disabled={busy || (!!formId && rows.some((r) => r.id === formId))}
              title={formId && rows.some((r) => r.id === formId) ? t('feedTablesIdLockedHint') : undefined}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('feedTablesName')}</span>
            <input
              className="w-full rounded border border-border bg-elevated px-3 py-2 text-sm"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('feedTablesMapping')}</span>
            <textarea
              className="h-[min(52vh,480px)] w-full resize-y rounded border border-border bg-slate-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-200"
              spellCheck={false}
              value={formMapping}
              onChange={(e) => setFormMapping(e.target.value)}
              disabled={busy}
            />
          </label>

          {formId === BUILTIN_VIP_FEED_TABLE_ID && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('feedTablesBuiltinHint')}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !formName.trim() || !formMapping.trim()}
              className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-gold/90 disabled:opacity-50"
              onClick={() => void handleSave()}
            >
              {t('save')}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !formId.trim() ||
                formId === BUILTIN_VIP_FEED_TABLE_ID ||
                !rows.some((r) => r.id === formId.trim())
              }
              className="rounded-md border border-red-800/60 px-4 py-2 text-sm text-red-300 hover:bg-red-950/50 disabled:opacity-40"
              onClick={() => void handleDelete()}
            >
              {t('feedTablesDelete')}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
