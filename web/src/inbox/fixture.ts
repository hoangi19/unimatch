// Test rows for the Inbox tab.
import { vi } from 'vitest'
import { createHub, type ConversationRow, type InboxData, type LiveEvent, type LiveListener, type MessageRow } from './data'

/** Stub data with a live feed; `emit` pushes an event to every subscriber. */
export function liveData(patch: Partial<InboxData> = {}) {
  let send: LiveListener = () => {}
  const subscribe = createHub((emit) => {
    send = emit
    return () => (send = () => {})
  })
  const data: InboxData = {
    loadPages: vi.fn(async () => []),
    loadConversations: vi.fn(async (): Promise<ConversationRow[]> => []),
    loadMessages: vi.fn(async (): Promise<MessageRow[]> => []),
    loadUnread: vi.fn(async () => []),
    markRead: vi.fn(async () => {}),
    subscribe: vi.fn(subscribe),
    loadDetails: vi.fn(async () => ({ notes: '', language: null, created_at: '2026-11-01T09:00:00Z', stats: { user: 0, bot: 0, admin: 0, handoffs: 0 } })),
    saveNotes: vi.fn(async () => {}),
    ...patch,
  }
  return { data, emit: (event: LiveEvent) => send(event) }
}

export const conv = (patch: Partial<ConversationRow> = {}): ConversationRow => ({
  id: 'c1',
  page_id: 'p1',
  psid: 'psid-1',
  customer_name: 'Nguyễn Văn An',
  customer_picture_url: null,
  status: 'bot',
  last_message_at: '2026-11-10T08:00:00Z',
  last_message_preview: 'Có việc part-time không?',
  unread_count: 0,
  handoff_reason: null,
  ...patch,
})

export const msg = (patch: Partial<MessageRow> = {}): MessageRow => ({
  id: 'm1',
  conversation_id: 'c1',
  admin_id: null,
  attachments: null,
  created_at: '2026-11-10T08:00:00Z',
  delivery_error: null,
  delivery_status: 'sent',
  event: null,
  external_id: null,
  sender_kind: 'user',
  text: 'Xin chào',
  trace: null,
  ...patch,
})
