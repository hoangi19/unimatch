// What the Inbox tab needs from the outside world. Injected so tests run without Supabase.
import type { Translate } from '../i18n'
import type { Json, Tables } from '../lib/database.types'

export const CONVERSATION_COLUMNS =
  'id, page_id, psid, customer_name, customer_picture_url, status, last_message_at, last_message_preview, unread_count, handoff_reason'
export type ConversationRow = Pick<
  Tables<'conversations'>,
  | 'id'
  | 'page_id'
  | 'psid'
  | 'customer_name'
  | 'customer_picture_url'
  | 'status'
  | 'last_message_at'
  | 'last_message_preview'
  | 'unread_count'
  | 'handoff_reason'
>
export type MessageRow = Tables<'messages'>
export type InboxPage = Pick<Tables<'pages'>, 'id' | 'name'>
/** Keyset cursor: the oldest message already shown. */
export type Cursor = { createdAt: string; id: string }

export type InboxData = {
  /** Each method throws on a database error. */
  loadPages(): Promise<InboxPage[]>
  loadConversations(): Promise<ConversationRow[]>
  /** Up to MESSAGE_PAGE messages older than `before` (newest when omitted), oldest first. */
  loadMessages(conversationId: string, before?: Cursor): Promise<MessageRow[]>
}

// shortcut: the list loads at most this many conversations and filters them in the browser; page on the server when a deployment outgrows it.
export const CONVERSATION_LIMIT = 500
export const MESSAGE_PAGE = 50

export const STATUSES = ['needs_human', 'bot', 'human', 'closed'] as const
export type Status = (typeof STATUSES)[number]
export const FILTERS = ['all', ...STATUSES] as const
export type Filter = (typeof FILTERS)[number]

export const isStatus = (value: string): value is Status => (STATUSES as readonly string[]).includes(value)

const time = (iso: string | null) => (iso ? Date.parse(iso) : -Infinity)

/** Conversations waiting for a person first, then the latest message first; no message yet goes last. */
export function sortConversations(rows: ConversationRow[]): ConversationRow[] {
  return [...rows].sort(
    (a, b) => Number(b.status === 'needs_human') - Number(a.status === 'needs_human') || time(b.last_message_at) - time(a.last_message_at),
  )
}

/** Lowercase without Vietnamese diacritics, so "nguyen" finds "Nguyễn". */
export const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

export function matchesSearch(row: ConversationRow, query: string): boolean {
  const q = fold(query.trim())
  return !q || [row.customer_name, row.psid, row.last_message_preview].some((field) => field && fold(field).includes(q))
}

export function countByFilter(rows: ConversationRow[]): Record<Filter, number> {
  const counts = { all: rows.length, needs_human: 0, bot: 0, human: 0, closed: 0 }
  rows.forEach((row) => isStatus(row.status) && counts[row.status]++)
  return counts
}

/** Merges messages by id and keeps them in (created_at, id) order. */
export function mergeMessages(current: MessageRow[], incoming: MessageRow[]): MessageRow[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  incoming.forEach((m) => byId.set(m.id, m))
  return [...byId.values()].sort((a, b) => time(a.created_at) - time(b.created_at) || a.id.localeCompare(b.id))
}

export const EVENT_CODES = ['handoff', 'takeover', 'return_to_bot'] as const
export const EVENT_REASONS = ['keyword', 'send_failed', 'bot_error', 'low_confidence', 'complaint'] as const
export type SystemEvent = {
  code: (typeof EVENT_CODES)[number] | 'other'
  reason?: (typeof EVENT_REASONS)[number] | 'other'
  keyword?: string
}

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | 'other' => (list as readonly unknown[]).includes(value) ? (value as T) : 'other'

/** Reads a system message's `event`. Unknown codes and reasons become 'other'; a missing event is a generic one. */
export function parseEvent(event: Json | null): SystemEvent {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { code: 'other' }
  const { code, reason, keyword } = event
  return {
    code: oneOf(EVENT_CODES, code),
    ...(reason != null && { reason: oneOf(EVENT_REASONS, reason) }),
    ...(typeof keyword === 'string' && keyword && { keyword }),
  }
}

export const ATTACHMENT_TYPES = ['image', 'video', 'audio', 'file'] as const
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number] | 'other'

/** One entry per Messenger attachment, by its `type`. */
export function attachmentTypes(attachments: Json | null): AttachmentType[] {
  if (!Array.isArray(attachments)) return []
  return attachments.map((a) => oneOf(ATTACHMENT_TYPES, a && typeof a === 'object' && !Array.isArray(a) ? a.type : undefined))
}

/** Clock time for today, a short date otherwise (with the year when it differs). */
export function shortTime(iso: string, lang: string, now = new Date()): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === now.toDateString()
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'numeric', ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }) }
  return new Intl.DateTimeFormat(lang, options).format(date)
}

/** One line for a system event, e.g. "Handed to a person · customer sent “help”". */
export function eventText(t: Translate, event: SystemEvent, legacyText: string | null): string {
  const head = t(`inbox.event.${event.code}`)
  if (!event.reason) return event.code === 'other' && legacyText ? `${head}: ${legacyText}` : head
  const reason = event.reason === 'keyword' && event.keyword ? t('inbox.reason.keywordNamed', { keyword: event.keyword }) : t(`inbox.reason.${event.reason}`)
  return `${head} · ${reason}`
}
