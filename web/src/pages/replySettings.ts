// Maps a `pages` row's reply settings to the Pages tab form and back. The row shape is read by the reply worker.
import type { MessageKey } from '../i18n'
import type { Json, Tables } from '../lib/database.types'

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Day = (typeof DAYS)[number]
export const TZ = 'Asia/Ho_Chi_Minh'
export const MAX_DELAY_S = 10

export type ReplyRow = Pick<Tables<'pages'>, 'reply_mode' | 'reply_hours' | 'handoff_keywords' | 'reply_delay_ms'>
export type ReplyForm = { mode: 'always' | 'hours'; start: string; end: string; days: Day[]; keywords: string; delayS: number }
export type ReplyErrors = Partial<Record<'days' | 'end', MessageKey>>

const DEFAULT_HOURS = { start: '08:00', end: '17:30', days: DAYS.slice(0, 5) as Day[] }

// shortcut: the form edits one time range shared by the chosen days; rows with several ranges, or different
// ranges per day, load the first range found. Upgrade when admins need per-day hours.
export function toForm(row: ReplyRow): ReplyForm {
  const raw = row.reply_hours as { days?: Partial<Record<Day, [string, string][]>> } | null
  const days = DAYS.filter((d) => (raw?.days?.[d]?.length ?? 0) > 0)
  const first = days.length ? raw!.days![days[0]]![0] : null
  return {
    mode: row.reply_mode === 'hours' ? 'hours' : 'always',
    start: first?.[0] ?? DEFAULT_HOURS.start,
    end: first?.[1] ?? DEFAULT_HOURS.end,
    days: days.length ? days : DEFAULT_HOURS.days,
    keywords: row.handoff_keywords.join(', '),
    delayS: Math.round(row.reply_delay_ms / 1000),
  }
}

export function toRow(form: ReplyForm): ReplyRow {
  const range: [string, string][] = [[form.start, form.end]]
  const days = Object.fromEntries(DAYS.map((d) => [d, form.days.includes(d) ? range : []]))
  const keywords = form.keywords.split(',').map((k) => k.trim()).filter(Boolean)
  return {
    reply_mode: form.mode,
    reply_hours: { tz: TZ, days } as Json,
    handoff_keywords: [...new Set(keywords)],
    reply_delay_ms: Math.min(Math.max(Math.round(form.delayS), 0), MAX_DELAY_S) * 1000,
  }
}

/** Only hours mode has rules; "HH:MM" strings compare correctly as text. */
export function validate(form: ReplyForm): ReplyErrors {
  if (form.mode !== 'hours') return {}
  const errors: ReplyErrors = {}
  if (!form.days.length) errors.days = 'pages.ps.errDays'
  if (!form.start || !form.end || form.start >= form.end) errors.end = 'pages.ps.errRange'
  return errors
}

export const sameForm = (a: ReplyForm, b: ReplyForm) => JSON.stringify(a) === JSON.stringify(b)
