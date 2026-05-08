import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import type { AppLocale } from './types'
import { translate, type MessageKey } from './messages'

type I18nValue = {
  locale: AppLocale
  t: (key: MessageKey) => string
  setLocale: (next: AppLocale) => void
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider(props: {
  children: ReactNode
  locale: AppLocale
  onLocaleChange: (locale: AppLocale) => void
}): React.ReactElement {
  const { locale, onLocaleChange } = props
  const t = useCallback((key: MessageKey) => translate(locale, key), [locale])
  const value = useMemo(
    () => ({ locale, t, setLocale: onLocaleChange }),
    [locale, t, onLocaleChange]
  )
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
