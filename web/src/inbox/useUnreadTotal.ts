import { useEffect, useState } from 'react'
import { unreadTotal, type InboxData } from './data'

/** Unread messages over all conversations, kept live. Zero until loaded or while the load fails. */
export function useUnreadTotal(data: InboxData | undefined): number {
  const [counts, setCounts] = useState(() => new Map<string, number>())

  useEffect(() => {
    if (!data) return
    let live = true
    const load = () =>
      data.loadUnread().then(
        (rows) => live && setCounts(new Map(rows.map((r) => [r.id, r.unread_count]))),
        () => {},
      )
    void load()
    const unsubscribe = data.subscribe((event) => {
      const set = (id: string, n: number) =>
        setCounts((c) => {
          const next = new Map(c)
          if (n > 0) next.set(id, n)
          else next.delete(id)
          return next
        })
      if (event.type === 'conversation') set(event.row.id, event.row.unread_count)
      if (event.type === 'conversationDeleted') set(event.id, 0)
      if (event.type === 'resync') void load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [data])

  return unreadTotal(counts)
}
