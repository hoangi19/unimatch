import { supabase } from '../lib/supabase'
import { CONVERSATION_COLUMNS, CONVERSATION_LIMIT, MESSAGE_PAGE, type InboxData } from './data'

function rows<T>({ data, error }: { data: T[] | null; error: { message: string } | null }): T[] {
  if (error) throw new Error(error.message)
  return data ?? []
}

export const supabaseInboxData: InboxData = {
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
