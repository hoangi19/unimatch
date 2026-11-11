import { supabase } from '../lib/supabase'
import { CONVERSATION_COLUMNS, CONVERSATION_LIMIT, createHub, MESSAGE_PAGE, type ConversationRow, type InboxData, type MessageRow } from './data'

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
}
