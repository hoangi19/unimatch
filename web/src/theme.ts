import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

// index.html reads the same key before first paint, so keep them in sync.
export const THEME_KEY = 'um-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** Follows the OS setting until the user picks a theme, then remembers the pick. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme())

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const media = matchMedia(DARK_QUERY)
    const onChange = () => {
      if (!storedTheme()) setTheme(systemTheme())
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    setTheme(next)
  }

  return { theme, toggleTheme }
}
