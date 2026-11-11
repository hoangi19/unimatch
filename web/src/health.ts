import { useEffect, useState } from 'react'
import { pageStatus, type PagesData } from './pages/data'

/** Page token health for the shell. The hourly server check marks bad tokens; this only reads rows. */
export type PageHealth = { total: number; invalid: number }

const POLL_MS = 5 * 60_000

/** Null until the first load, and while the last load failed. Reloads on `key` change, focus and every 5 min. */
export function usePageHealth(data: PagesData | undefined, key: unknown): PageHealth | null {
  const [health, setHealth] = useState<PageHealth | null>(null)

  useEffect(() => {
    if (!data) return
    let live = true
    const load = () =>
      data.loadRows().then(
        (rows) => {
          const connected = rows.map((r) => pageStatus(r, Date.now())).filter((s) => s.kind !== 'disconnected')
          if (live) setHealth({ total: connected.length, invalid: connected.filter((s) => s.kind === 'expired').length })
        },
        () => live && setHealth(null),
      )
    void load()
    const timer = setInterval(load, POLL_MS)
    addEventListener('focus', load)
    return () => {
      live = false
      clearInterval(timer)
      removeEventListener('focus', load)
    }
  }, [data, key])

  return health
}
