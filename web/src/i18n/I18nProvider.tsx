import { useEffect, useState, type ReactNode } from 'react'
import { I18nContext, LANG_KEY, storedLang, translate, type Lang, type Translate } from './core'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(storedLang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = (next: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, next)
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    setLangState(next)
  }

  const t: Translate = (key, params) => translate(lang, key, params)
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}
