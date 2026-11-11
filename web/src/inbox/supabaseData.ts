import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { CONVERSATION_COLUMNS, CONVERSATION_LIMIT, createHub, MESSAGE_PAGE, toSendResult, type ConversationRow, type InboxData, type MessageRow } from './data'

function check(error: PostgrestError | null) {
  if (error) throw new Error(error.message)
}

function rows<T>({ data, error }: { data: T[] | null; error: { message: string } | null }): T[] {
  if (error) throw new Error(error.message)
  return data ?? []
}

// One channel for the whole Inbox; RLS limits the rows to admins. supabase-js rejoins it after a drop.
const subscribe = createHub((emit) => {
  const channel = supabase
    .channel('inbox')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, (change) =>
      emit(
        change.eventType === 'DELETE'
          ? { type: 'conversationDeleted', id: (change.old as { id: string }).id }
          : { type: 'conversation', row: change.new as ConversationRow },
      ),
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (change) => emit({ type: 'message', row: change.new as MessageRow }))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (change) => emit({ type: 'message', row: change.new as MessageRow }))
    // Rows written before a join (the first one included, which may land after the first load) are refetched.
    .subscribe((status) => status === 'SUBSCRIBED' && emit({ type: 'resync' }))
  return () => void supabase.removeChannel(channel)
})

export const supabaseInboxData: InboxData = {
  subscribe,
  loadUnread: async () => rows(await supabase.from('conversations').select('id, unread_count').gt('unread_count', 0)),
  async markRead(conversationId) {
    const { error } = await supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId)
    if (error) throw new Error(error.message)
  },
  loadPages: async () => rows(await supabase.from('pages').select('id, name').order('connected_at')),
  loadConversations: async () =>
    rows(
      await supabase
        .from('conversations')
        .select(CONVERSATION_COLUMNS)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(CONVERSATION_LIMIT),
    ),
  async loadMessages(conversationId, before) {
    let query = supabase.from('messages').select('*').eq('conversation_id', conversationId)
    // Keyset on (created_at, id): messages sharing a timestamp are neither skipped nor repeated.
    if (before) query = query.or(`created_at.lt."${before.createdAt}",and(created_at.eq."${before.createdAt}",id.lt.${before.id})`)
    const page = rows(await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MESSAGE_PAGE))
    return page.reverse()
  },
  async loadDetails(conversationId) {
    // Head-only counts: index-backed, no rows come back.
    const count = (sender: string) =>
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).eq('sender_kind', sender)
    const [conv, user, bot, admin, handoffs] = await Promise.all([
      supabase.from('conversations').select('notes, language, created_at').eq('id', conversationId).single(),
      count('user'),
      count('bot'),
      count('admin'),
      count('system').eq('event->>code', 'handoff'),
    ])
    ;[conv, user, bot, admin, handoffs].forEach((r) => check(r.error))
    return { ...conv.data!, stats: { user: user.count ?? 0, bot: bot.count ?? 0, admin: admin.count ?? 0, handoffs: handoffs.count ?? 0 } }
  },
  async saveNotes(conversationId, notes) {
    // RLS hides the row from non-admins, so zero updated rows is an error too.
    const { data, error } = await supabase.from('conversations').update({ notes }).eq('id', conversationId).select('id')
    check(error)
    if (!data?.length) throw new Error('conversation not found')
  },
  async setMode(conversationId, mode) {
    check((await supabase.rpc('set_conversation_mode', { p_conversation_id: conversationId, p_mode: mode })).error)
  },
  async send(conversationId, text, retryOf) {
    // invoke() sends the signed-in admin's access token. A non-2xx answer (404, 500) still carries a typed body.
    const { data, error } = await supabase.functions.invoke('send-message', {
      body: { conversation_id: conversationId, text, ...(retryOf && { retry_of: retryOf }) },
    })
    return toSendResult(data ?? (await errorBody(error)))
  },
  async loadQuickReplies() {
    const { data, error } = await supabase.from('bot_settings').select('quick_replies').maybeSingle()
    check(error)
    return data?.quick_replies ?? []
  },
  async loadStats(pageId) {
    const { data, error } = await supabase.rpc('inbox_stats', pageId ? { p_page_id: pageId } : {}).single()
    check(error)
    return data!
  },
}

async function errorBody(error: unknown): Promise<unknown> {
  const response = (error as { context?: unknown } | null)?.context
  return response instanceof Response ? response.json().catch(() => null) : null
}
