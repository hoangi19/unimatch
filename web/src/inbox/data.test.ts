import { describe, expect, it, vi } from 'vitest'
import { translate } from '../i18n'
import {
  attachmentTypes,
  createHub,
  countByFilter,
  eventText,
  matchesSearch,
  mergeMessages,
  parseEvent,
  shortTime,
  sortConversations,
  type LiveListener,
} from './data'
import { conv, msg } from './fixture'

describe('sortConversations', () => {
  it('pins needs_human first, then newest, with no message last', () => {
    const rows = [
      conv({ id: 'none', last_message_at: null }),
      conv({ id: 'old', last_message_at: '2026-11-01T00:00:00Z' }),
      conv({ id: 'needs', status: 'needs_human', last_message_at: '2026-10-01T00:00:00Z' }),
      conv({ id: 'new', last_message_at: '2026-11-11T00:00:00Z' }),
    ]
    expect(sortConversations(rows).map((c) => c.id)).toEqual(['needs', 'new', 'old', 'none'])
  })
})

describe('matchesSearch', () => {
  it('ignores case and Vietnamese diacritics across name, PSID and preview', () => {
    const row = conv()
    expect(matchesSearch(row, 'nguyen')).toBe(true)
    expect(matchesSearch(row, 'PSID-1')).toBe(true)
    expect(matchesSearch(row, 'part-time')).toBe(true)
    expect(matchesSearch(conv({ customer_name: 'Đức' }), 'duc')).toBe(true)
    expect(matchesSearch(row, 'zzz')).toBe(false)
    expect(matchesSearch(row, '  ')).toBe(true)
  })
})

it('counts conversations per status filter', () => {
  const rows = [conv({ status: 'bot' }), conv({ status: 'needs_human' }), conv({ status: 'needs_human' }), conv({ status: 'closed' })]
  expect(countByFilter(rows)).toEqual({ all: 4, needs_human: 2, bot: 1, human: 0, closed: 1 })
})

it('merges messages by id in (created_at, id) order, later input winning', () => {
  const a = msg({ id: 'a', created_at: '2026-11-10T08:00:00Z' })
  const b = msg({ id: 'b', created_at: '2026-11-10T08:00:00Z' })
  const c = msg({ id: 'c', created_at: '2026-11-10T07:00:00Z' })
  const merged = mergeMessages([b, a], [c, msg({ id: 'a', created_at: a.created_at, text: 'new' })])
  expect(merged.map((m) => m.id)).toEqual(['c', 'a', 'b'])
  expect(merged[1].text).toBe('new')
})

describe('parseEvent', () => {
  it('reads known codes, reasons and the keyword', () => {
    expect(parseEvent({ code: 'handoff', reason: 'keyword', keyword: 'help' })).toEqual({ code: 'handoff', reason: 'keyword', keyword: 'help' })
    expect(parseEvent({ code: 'takeover' })).toEqual({ code: 'takeover' })
  })
  it('maps unknown codes and reasons to other, and missing events to a generic one', () => {
    expect(parseEvent({ code: 'renamed', reason: 'weird' })).toEqual({ code: 'other', reason: 'other' })
    expect(parseEvent(null)).toEqual({ code: 'other' })
    expect(parseEvent(['handoff'])).toEqual({ code: 'other' })
  })
})

describe('eventText', () => {
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate('en', key, params)
  it('joins the event and its reason', () => {
    expect(eventText(t, { code: 'handoff', reason: 'keyword', keyword: 'help' }, null)).toBe('Handed to a person · customer sent “help”')
    expect(eventText(t, { code: 'handoff', reason: 'low_confidence' }, null)).toBe('Handed to a person · the bot was not confident')
    expect(eventText(t, { code: 'return_to_bot' }, null)).toBe('Returned to the bot')
  })
  it('falls back to a generic label, keeping legacy free text', () => {
    expect(eventText(t, { code: 'other' }, 'Chuyển do khách phàn nàn')).toBe('System event: Chuyển do khách phàn nàn')
    expect(eventText(t, { code: 'other' }, null)).toBe('System event')
  })
})

it('lists attachment types, unknown ones as other', () => {
  expect(attachmentTypes([{ type: 'image' }, { type: 'sticker' }, 'x'])).toEqual(['image', 'other', 'other'])
  expect(attachmentTypes(null)).toEqual([])
})

it('shows a clock time today and a date otherwise', () => {
  const now = new Date(2026, 10, 12, 15, 0)
  expect(shortTime(new Date(2026, 10, 12, 9, 5).toISOString(), 'en-GB', now)).toBe('09:05')
  expect(shortTime(new Date(2026, 10, 3, 9, 5).toISOString(), 'en-GB', now)).toBe('03/11')
  expect(shortTime(new Date(2025, 10, 3, 9, 5).toISOString(), 'en-GB', now)).toBe('03/11/2025')
})

describe('createHub', () => {
  it('opens one source for many listeners and closes it after the last one leaves', () => {
    const close = vi.fn()
    let send: LiveListener = () => {}
    const open = vi.fn((emit: LiveListener) => ((send = emit), close))
    const subscribe = createHub(open)
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribe(a)
    const offB = subscribe(b)
    send({ type: 'resync' })
    expect([a.mock.calls.length, b.mock.calls.length, open.mock.calls.length]).toEqual([1, 1, 1])
    offA()
    expect(close).not.toHaveBeenCalled()
    offB()
    expect(close).toHaveBeenCalledOnce()
    subscribe(a)
    expect(open).toHaveBeenCalledTimes(2)
  })
})
