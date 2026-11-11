import { createContext, useContext } from 'react'
import { en, type MessageKey } from './en'
import { vi } from './vi'
import type { Format } from './format'

export type Lang = 'vi' | 'en'
export type { MessageKey }
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string
export type I18n = { lang: Lang; setLang: (lang: Lang) => void; t: Translate; fmt: Format }

export const LANGS: readonly Lang[] = ['vi', 'en']
// index.html reads the same key before first paint, so keep them in sync.
export const LANG_KEY = 'um-lang'
const DICTS: Record<Lang, Record<MessageKey, string>> = { vi, en }

/** Fills {name} placeholders; unknown placeholders stay as written. */
export function format(text: string, params?: Record<string, string | number>): string {
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text
}

export function translate(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string {
  return format(DICTS[lang][key], params)
}

export function storedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'vi'
  } catch {
    return 'vi'
  }
}

export const I18nContext = createContext<I18n | null>(null)

export function useI18n(): I18n {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n needs an I18nProvider')
  return value
}
