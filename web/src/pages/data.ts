// What the Pages tab needs from the outside world. Injected so tests run without Supabase or Facebook.
import type { Tables } from '../lib/database.types'
import type { PageSummary, PagesResult } from '../lib/pages'

// Keep in sync with SUBSCRIBED_FIELDS in supabase/functions/pages/handler.ts.
export const SUBSCRIBED_FIELDS = ['messages', 'messaging_postbacks', 'message_echoes', 'message_deliveries', 'message_reads']

export const PAGE_COLUMNS =
  'id, name, picture_url, bot_enabled, token_expires_at, access_token_secret_id, reply_mode, reply_hours, handoff_keywords, reply_delay_ms'
export type PageRow = Pick<
  Tables<'pages'>,
  | 'id'
  | 'name'
  | 'picture_url'
  | 'bot_enabled'
  | 'token_expires_at'
  | 'access_token_secret_id'
  | 'reply_mode'
  | 'reply_hours'
  | 'handoff_keywords'
  | 'reply_delay_ms'
>
/** The only columns an admin may update (column grant on `pages`). */
export type PageUpdate = Partial<Pick<PageRow, 'bot_enabled' | 'reply_mode' | 'reply_hours' | 'handoff_keywords' | 'reply_delay_ms'>>

export type PagesData = {
  /** Throws on a database error. */
  loadRows(): Promise<PageRow[]>
  /** Throws on a database error or when no row was updated. */
  updatePage(id: string, patch: PageUpdate): Promise<void>
  loadSdk(): Promise<unknown>
  /** Facebook Login popup; resolves to a short-lived user token. */
  login(): Promise<string>
  listPages(userToken: string): Promise<PagesResult<{ pages: PageSummary[] }>>
  connectPage(userToken: string, pageId: string): Promise<PagesResult<{ page: PageSummary }>>
  disconnectPage(pageId: string): Promise<PagesResult<object>>
  webhookUrl: string
}

const DAY_MS = 86_400_000

export type PageStatus = { kind: 'ok' | 'disconnected' | 'expired'; daysLeft: number | null }

/** Token state only, not a webhook health check. A null expiry means the token never expires. */
export function pageStatus(row: Pick<PageRow, 'access_token_secret_id' | 'token_expires_at'>, now: number): PageStatus {
  if (!row.access_token_secret_id) return { kind: 'disconnected', daysLeft: null }
  if (!row.token_expires_at) return { kind: 'ok', daysLeft: null }
  const left = Date.parse(row.token_expires_at) - now
  return left <= 0 ? { kind: 'expired', daysLeft: 0 } : { kind: 'ok', daysLeft: Math.ceil(left / DAY_MS) }
}
