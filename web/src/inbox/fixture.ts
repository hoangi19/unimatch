// Test rows for the Inbox tab.
import type { ConversationRow, MessageRow } from './data'

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
