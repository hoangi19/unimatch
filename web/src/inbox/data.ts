// What the Inbox tab needs from the outside world. Injected so tests run without Supabase.
import type { Translate } from '../i18n'
import type { Json, Tables } from '../lib/database.types'

export const CONVERSATION_COLUMNS =
  'id, page_id, psid, customer_name, customer_picture_url, status, last_message_at, last_message_preview, unread_count, handoff_reason, last_customer_message_at'
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
  | 'last_customer_message_at'
>
export type MessageRow = Tables<'messages'>
export type InboxPage = Pick<Tables<'pages'>, 'id' | 'name'>
/** Keyset cursor: the oldest message already shown. */
export type Cursor = { createdAt: string; id: string }
/** What the admin can set from the thread header. Reopen is 'bot'. */
export type Mode = 'human' | 'bot' | 'closed'
export const SEND_ERRORS = ['not_found', 'outside_window', 'token_invalid', 'rate_limit', 'user_unavailable', 'send_failed'] as const
export type SendErrorKind = (typeof SEND_ERRORS)[number]
/** The send-message function's answer. messageId is the stored row, null when nothing was stored. */
export type SendResult = { ok: true; messageId: string | null } | { ok: false; messageId: string | null; error: { kind: SendErrorKind; message: string } }

/** Maps the function's `{ok, message_id, error}` body; anything else is a generic failure. */
export function toSendResult(body: unknown): SendResult {
  const b = body && typeof body === 'object' ? (body as { ok?: unknown; message_id?: unknown; error?: { kind?: unknown; message?: unknown } }) : {}
  const messageId = typeof b.message_id === 'string' ? b.message_id : null
  if (b.ok === true) return { ok: true, messageId }
  const kind = b.error?.kind
  if (b.ok === false && (SEND_ERRORS as readonly unknown[]).includes(kind))
    return { ok: false, messageId, error: { kind: kind as SendErrorKind, message: String(b.error?.message ?? '') } }
  return { ok: false, messageId: null, error: { kind: 'send_failed', message: 'Unexpected response' } }
}

/** inbox_stats for today in Asia/Ho_Chi_Minh; the migration defines each number. */
export type InboxStats = {
  open_conversations: number
  waiting_for_human: number
  customer_conversations: number
  bot_handled: number
  avg_first_response_seconds: number | null
}

export type InboxData = {
  /** Each method throws on a database error. */
  loadPages(): Promise<InboxPage[]>
  loadConversations(): Promise<ConversationRow[]>
  /** Up to MESSAGE_PAGE messages older than `before` (newest when omitted), oldest first. */
  loadMessages(conversationId: string, before?: Cursor): Promise<MessageRow[]>
  /** Conversation ids with unread messages, for the sidebar count. */
  loadUnread(): Promise<Pick<ConversationRow, 'id' | 'unread_count'>[]>
  markRead(conversationId: string): Promise<void>
  /** Live row changes. All listeners share one connection; returns the unsubscribe. */
  subscribe(listener: LiveListener): () => void
  loadDetails(conversationId: string): Promise<ConversationDetails>
  saveNotes(conversationId: string, notes: string): Promise<void>
  /** Changes the status through set_conversation_mode, which writes the system event. */
  setMode(conversationId: string, mode: Mode): Promise<void>
  /** Never throws: a transport error is a `send_failed` result. `retryOf` is the failed row this attempt replaces. */
  send(conversationId: string, text: string, retryOf?: string): Promise<SendResult>
  loadQuickReplies(): Promise<string[]>
  /** Today's stats, for one Page when `pageId` is given. */
  loadStats(pageId?: string): Promise<InboxStats>
}

/** `resync`: the connection came back and rows may have been missed, so refetch. */
export type LiveEvent =
  | { type: 'conversation'; row: ConversationRow }
  | { type: 'conversationDeleted'; id: string }
  | { type: 'message'; row: MessageRow }
  | { type: 'resync' }
export type LiveListener = (event: LiveEvent) => void

/** Fans one source out to many listeners: `open` runs with the first listener, its cleanup after the last one leaves. */
export function createHub(open: (emit: LiveListener) => () => void) {
  const listeners = new Set<LiveListener>()
  let close: (() => void) | null = null
  return (listener: LiveListener) => {
    listeners.add(listener)
    close ??= open((event) => listeners.forEach((l) => l(event)))
    return () => {
      listeners.delete(listener)
      if (!listeners.size && close) {
        close()
        close = null
      }
    }
  }
}

/** Replaces the row with the same id, or adds it. */
export const upsertConversation = (rows: ConversationRow[], row: ConversationRow) => [...rows.filter((r) => r.id !== row.id), row]

/** Sum of unread messages over a map of conversation id to count. */
export const unreadTotal = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0)

// shortcut: the list loads at most this many conversations and filters them in the browser; page on the server when a deployment outgrows it.
export const CONVERSATION_LIMIT = 500
export const MESSAGE_PAGE = 50
export const NOTES_DEBOUNCE_MS = 800

export const STATUSES = ['needs_human', 'bot', 'human', 'closed'] as const
export type Status = (typeof STATUSES)[number]
export const FILTERS = ['all', ...STATUSES] as const
export type Filter = (typeof FILTERS)[number]

// Messenger only accepts standard replies within 24 hours of the customer's last message.
export const WINDOW_MS = 24 * 60 * 60 * 1000
export const windowOpen = (lastCustomerMessageAt: string | null, now = Date.now()) => now - time(lastCustomerMessageAt) < WINDOW_MS

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

export const EVENT_CODES = ['handoff', 'takeover', 'return_to_bot', 'close', 'reopen'] as const
export const EVENT_REASONS = ['keyword', 'send_failed', 'bot_error', 'low_confidence', 'complaint', 'human_request'] as const
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

/** One line for a system event, e.g. "Handed to a person · customer sent “help”". */
export function eventText(t: Translate, event: SystemEvent, legacyText: string | null): string {
  const head = t(`inbox.event.${event.code}`)
  if (!event.reason) return event.code === 'other' && legacyText ? `${head}: ${legacyText}` : head
  return `${head} · ${reasonText(t, event.reason, event.keyword)}`
}

/** A handoff reason code in words; unknown codes read as "other reason". */
export function reasonText(t: Translate, reason: string | null | undefined, keyword?: string): string {
  const code = oneOf(EVENT_REASONS, reason)
  return code === 'keyword' && keyword ? t('inbox.reason.keywordNamed', { keyword }) : t(`inbox.reason.${code}`)
}

export type MessageStats = { user: number; bot: number; admin: number; handoffs: number }
export type ConversationDetails = Pick<Tables<'conversations'>, 'notes' | 'language' | 'created_at'> & { stats: MessageStats }

export type Trace = {
  provider?: string
  model?: string
  latencyMs?: number
  tokens?: { input?: number; output?: number }
  /** Reply-hours decision and the hourly rate limit the gate saw. */
  hours?: string
  rate?: { used?: number; limit?: number }
  handoff?: (typeof EVENT_REASONS)[number] | 'other'
  fallback?: string
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Reads a bot message's `trace`; null when there is none. Fields of the wrong type are dropped. */
export function parseTrace(trace: Json | null): Trace | null {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return null
  const tokens = obj(trace.tokens)
  const gate = obj(trace.gate)
  return {
    provider: str(trace.provider),
    model: str(trace.model),
    latencyMs: num(trace.latencyMs),
    ...(trace.tokens != null && { tokens: { input: num(tokens.inputTokens), output: num(tokens.outputTokens) } }),
    hours: str(gate.hours),
    ...(trace.gate != null && { rate: { used: num(gate.botMessagesLastHour), limit: num(gate.rateLimitPerHour) } }),
    ...(trace.handoff != null && { handoff: oneOf(EVENT_REASONS, trace.handoff) }),
    fallback: str(trace.fallback),
  }
}
