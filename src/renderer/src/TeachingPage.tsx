import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { RendererApi } from './bridge'
import { useI18n } from './i18n/context'

const DEFAULT_TABLE_URL = 'https://fresh.casino/table/galaxsys-roulettex'

type TeachingEvt = {
  at?: number
  kind?: string
  tagName?: string
  textSnippet?: string
  selectorHint?: string
  pageX?: number
  pageY?: number
  frameUrl?: string
}

export default function TeachingPage(props: { api: RendererApi }): ReactElement {
  const { t } = useI18n()
  const { api } = props
  const [url, setUrl] = useState(DEFAULT_TABLE_URL)
  const [recording, setRecording] = useState(false)
  const [events, setEvents] = useState<TeachingEvt[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [mappingProfile, setMappingProfile] = useState('my-table')

  const refreshEvents = useCallback(async () => {
    const list = (await api.teaching.events()) as TeachingEvt[]
    setEvents(list)
  }, [api])

  const syncStatus = useCallback(async () => {
    const s = await api.teaching.status()
    setRecording(s.recording)
    await refreshEvents()
  }, [api, refreshEvents])

  useEffect(() => {
    void syncStatus()
  }, [syncStatus])

  useEffect(() => {
    const off = api.onTeachingEvent((ev) => {
      setEvents((prev) => [...prev, ev as TeachingEvt])
    })
    return off
  }, [api])

  const onOpenTable = async (): Promise<void> => {
    setError(null)
    setSavedPath(null)
    try {
      await api.browser.launch(url.trim() || undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onStart = async (): Promise<void> => {
    setError(null)
    setSavedPath(null)
    const r = await api.teaching.start()
    if (!r.ok) {
      setError(r.error)
      setRecording(false)
      return
    }
    setRecording(true)
    await refreshEvents()
  }

  const onStop = async (): Promise<void> => {
    setError(null)
    await api.teaching.stop()
    setRecording(false)
    await refreshEvents()
  }

  const onClear = async (): Promise<void> => {
    setError(null)
    setSavedPath(null)
    await api.teaching.clear()
    setEvents([])
  }

  const onSave = async (): Promise<void> => {
    setError(null)
    try {
      const r = await api.teaching.save()
      setSavedPath(r.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onSaveMapping = async (): Promise<void> => {
    setError(null)
    const r = await api.teaching.saveMapping(mappingProfile.trim() || 'default')
    if (!r.ok) {
      setError(r.error)
      return
    }
    setSavedPath(r.path)
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold text-gold">{t('teachTitle')}</h1>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('teachIntro')}</p>

      {error && (
        <div
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-danger dark:border-red-900 dark:bg-red-950"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="grid max-w-xl gap-3 rounded-lg border border-border bg-elevated p-4">
        <label className="block text-sm">
          <span className="text-xs uppercase text-slate-500">{t('teachUrl')}</span>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 font-mono text-sm"
            value={url}
            onChange={(e) => void setUrl(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs uppercase text-slate-500">{t('teachMappingProfile')}</span>
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 font-mono text-sm"
            value={mappingProfile}
            onChange={(e) => void setMappingProfile(e.target.value)}
            placeholder={t('teachMappingProfilePh')}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => void onOpenTable()}
          >
            {t('teachOpenTable')}
          </button>
          {!recording ? (
            <button
              type="button"
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
              onClick={() => void onStart()}
            >
              {t('teachStart')}
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white"
              onClick={() => void onStop()}
            >
              {t('teachStop')}
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm"
            onClick={() => void onClear()}
          >
            {t('teachClear')}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm"
            onClick={() => void onSave()}
          >
            {t('teachSave')}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm"
            onClick={() => void onSaveMapping()}
          >
            {t('teachSaveMapping')}
          </button>
        </div>
        {recording && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{t('teachRecording')}</p>
        )}
        {savedPath && (
          <p className="font-mono text-xs text-slate-500">
            {t('teachSaved')}: {savedPath}
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('teachEvents')}</h2>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">{t('teachNoEvents')}</p>
        ) : (
          <ul className="max-h-[420px] space-y-2 overflow-auto rounded border border-border bg-surface p-3 font-mono text-xs">
            {events.map((ev, i) => (
              <li key={`${ev.at ?? i}-${i}`} className="border-b border-border/60 pb-2 last:border-0">
                <span className="text-slate-400">
                  {ev.kind ?? '?'} · ({Math.round(ev.pageX ?? 0)}, {Math.round(ev.pageY ?? 0)})
                </span>
                <div className="mt-0.5 text-slate-300">{ev.selectorHint ?? '—'}</div>
                {(ev.textSnippet || ev.tagName) && (
                  <div className="mt-0.5 text-slate-500">
                    <span className="text-slate-400">
                      {ev.tagName ? `<${ev.tagName.toLowerCase()}>` : '?'}
                    </span>{' '}
                    {ev.textSnippet ?? ''}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
