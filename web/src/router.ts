import { useEffect, useState } from 'react'

export const TABS = ['inbox', 'pages', 'dataset', 'chatbot'] as const
export type Tab = (typeof TABS)[number]

export const DEFAULT_TAB: Tab = 'inbox'

/** Maps a URL path to a tab, or null when the path is not a tab. */
export function tabFromPath(path: string): Tab | null {
  const segment = path.replace(/^\/+|\/+$/g, '')
  return (TABS as readonly string[]).includes(segment) ? (segment as Tab) : null
}

function currentTab(): Tab {
  const tab = tabFromPath(location.pathname)
  // Unknown paths and "/" land on the default tab without adding a history entry.
  if (!tab) history.replaceState(null, '', `/${DEFAULT_TAB}`)
  return tab ?? DEFAULT_TAB
}

/** One URL per tab, so deep links, reloads and the back button work. */
export function useTab() {
  const [tab, setTab] = useState<Tab>(currentTab)

  useEffect(() => {
    const onPop = () => setTab(currentTab())
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  const navigate = (next: Tab) => {
    if (next === tab) return
    history.pushState(null, '', `/${next}`)
    setTab(next)
  }

  return { tab, navigate }
}
