import React, { createContext, useContext, useMemo, ReactNode } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import de from './translations/de'
import en from './translations/en'
import es from './translations/es'
import fr from './translations/fr'
import ru from './translations/ru'
import zh from './translations/zh'
import nl from './translations/nl'

type TranslationStrings = Record<string, string>

const translations: Record<string, TranslationStrings> = { de, en, es, fr, ru, zh, nl }
const LOCALES: Record<string, string> = { de: 'de-DE', en: 'en-US', es: 'es-ES', fr: 'fr-FR', ru: 'ru-RU', zh: 'zh-CN', nl: 'nl-NL' }

export function getLocaleForLanguage(language: string): string {
  return LOCALES[language] || LOCALES.en
}

export function getIntlLanguage(language: string): string {
  return ['de', 'es', 'fr', 'ru', 'zh', 'nl'].includes(language) ? language : 'en'
}

interface TranslationContextValue {
  t: (key: string, params?: Record<string, string | number>) => string
  language: string
  locale: string
}

const TranslationContext = createContext<TranslationContextValue>({ t: (k: string) => k, language: 'en', locale: 'en-US' })

interface TranslationProviderProps {
  children: ReactNode
}

export function TranslationProvider({ children }: TranslationProviderProps) {
  const language = useSettingsStore((s) => s.settings.language) || 'en'

  const value = useMemo((): TranslationContextValue => {
    const strings = translations[language] || translations.en
    const fallback = translations.en

    function t(key: string, params?: Record<string, string | number>): string {
      let val: string = strings[key] ?? fallback[key] ?? key
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
        })
      }
      return val
    }

    return { t, language, locale: getLocaleForLanguage(language) }
  }, [language])

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>
}

export function useTranslation(): TranslationContextValue {
  return useContext(TranslationContext)
}
