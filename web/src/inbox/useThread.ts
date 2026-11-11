import { useCallback, useEffect, useState } from 'react'
import { mergeMessages, MESSAGE_PAGE, type InboxData, type MessageRow } from './data'

type ThreadState = { messages: MessageRow[]; hasMore: boolean; status: 'loading' | 'ready' | 'error'; loadingOlder: boolean }

const INITIAL: ThreadState = { messages: [], hasMore: false, status: 'loading', loadingOlder: false }

/** Messages of one conversation, oldest first. Mount it per conversation (`key`). `upsert` takes live and sent messages. */
export function useThread(data: InboxData, conversationId: string) {
  const [state, setState] = useState<ThreadState>(INITIAL)

  const load = useCallback(() => {
    data.loadMessages(conversationId).then(
      (page) => setState({ messages: page, hasMore: page.length === MESSAGE_PAGE, status: 'ready', loadingOlder: false }),
      () => setState((s) => ({ ...s, status: 'error' })),
    )
  }, [data, conversationId])

  useEffect(load, [load])

  /** Resolves false when the request failed. */
  const loadOlder = async () => {
    const oldest = state.messages[0]
    if (!oldest || state.loadingOlder) return false
    setState((s) => ({ ...s, loadingOlder: true }))
    try {
      const page = await data.loadMessages(conversationId, { createdAt: oldest.created_at, id: oldest.id })
      // Messages already shown win: they may be fresher than the fetched page.
      setState((s) => ({ ...s, messages: mergeMessages(page, s.messages), hasMore: page.length === MESSAGE_PAGE, loadingOlder: false }))
      return true
    } catch {
      setState((s) => ({ ...s, loadingOlder: false }))
      return false
    }
  }

  const upsert = useCallback((message: MessageRow) => setState((s) => ({ ...s, messages: mergeMessages(s.messages, [message]) })), [])

  const reload = () => {
    setState(INITIAL)
    load()
  }

  return { ...state, reload, loadOlder, upsert }
}
