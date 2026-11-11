import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { I18nProvider, translate, type MessageKey } from '../i18n'
import { ToastProvider } from '../ui/ToastProvider'
import { MESSAGE_PAGE, NOTES_DEBOUNCE_MS, type ConversationDetails, type InboxData } from './data'
import { conv, liveData, msg } from './fixture'
import { InboxTab } from './InboxTab'

beforeAll(() => {
  // jsdom has no <dialog> methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
  }
})

const t = (key: MessageKey, params?: Record<string, string | number>) => translate('vi', key, params)

const PAGES = [
  { id: 'p1', name: 'Page One' },
  { id: 'p2', name: 'Page Two' },
]
const CONVERSATIONS = [
  conv({ id: 'c-bot', customer_name: 'An Bot', last_message_at: '2026-11-11T10:00:00Z' }),
  conv({ id: 'c-needs', customer_name: 'Bình Cần', status: 'needs_human', page_id: 'p2', last_message_at: '2026-11-01T10:00:00Z' }),
  conv({ id: 'c-closed', customer_name: 'Chi Đóng', status: 'closed', last_message_at: '2026-11-05T10:00:00Z', last_message_preview: 'cảm ơn' }),
]

const DETAILS: ConversationDetails = { notes: 'Hỏi về Data Engineer', language: 'vi', created_at: '2026-11-01T09:00:00Z', stats: { user: 5, bot: 3, admin: 1, handoffs: 2 } }

const fakeLive = (patch: Partial<InboxData> = {}) =>
  liveData({ loadPages: vi.fn(async () => PAGES), loadConversations: vi.fn(async () => CONVERSATIONS), loadDetails: vi.fn(async () => DETAILS), ...patch })
const fakeData = (patch: Partial<InboxData> = {}): InboxData => fakeLive(patch).data

const renderTab = (data: InboxData, onConnectPage?: () => void) =>
  render(
    <I18nProvider>
      <ToastProvider>
        <InboxTab data={data} onConnectPage={onConnectPage} />
      </ToastProvider>
    </I18nProvider>,
  )

const rowNames = () => [...document.querySelectorAll('button.conv')].map((b) => b.id.slice('conv-'.length))
const filter = (key: MessageKey) => screen.getByRole('button', { name: new RegExp(`^${t(key)}`) })

describe('conversation list', () => {
  it('pins conversations that need help on top and counts each status', async () => {
    renderTab(fakeData())
    await screen.findByText('An Bot')
    expect(rowNames()).toEqual(['c-needs', 'c-bot', 'c-closed'])
    expect(filter('inbox.filter.all').textContent).toContain('3')
    expect([...filter('inbox.status.needs_human')!.classList]).toEqual(expect.arrayContaining(['has-needs']))
    expect(filter('inbox.status.needs_human').textContent).toContain('1')

    fireEvent.click(filter('inbox.status.closed'))
    expect(rowNames()).toEqual(['c-closed'])
    fireEvent.click(filter('inbox.status.human'))
    expect(screen.getByText(t('inbox.noneFilter'))).toBeTruthy()
  })

  it('searches without diacritics, filters by Page and clears a search with no results', async () => {
    renderTab(fakeData())
    await screen.findByText('An Bot')
    const search = screen.getByLabelText(t('inbox.search'))
    fireEvent.change(search, { target: { value: 'cam on' } })
    expect(rowNames()).toEqual(['c-closed'])
    expect(filter('inbox.filter.all').textContent).toContain('1')

    fireEvent.change(search, { target: { value: 'nobody' } })
    expect(screen.getByText(t('inbox.noResults', { q: 'nobody' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('inbox.clearSearch') }))
    expect(rowNames()).toHaveLength(3)

    fireEvent.change(screen.getByLabelText(t('inbox.pageFilter')), { target: { value: 'p2' } })
    expect(rowNames()).toEqual(['c-needs'])
  })

  it('offers to connect a Page when there are none', async () => {
    const onConnect = vi.fn()
    renderTab(fakeData({ loadPages: vi.fn(async () => []), loadConversations: vi.fn(async () => []) }), onConnect)
    fireEvent.click(await screen.findByRole('button', { name: t('inbox.connectPage') }))
    expect(onConnect).toHaveBeenCalled()
  })

  it('shows a retry when loading fails', async () => {
    const loadConversations = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(CONVERSATIONS)
    renderTab(fakeData({ loadConversations }))
    fireEvent.click(await screen.findByRole('button', { name: t('inbox.retry') }))
    expect(await screen.findByText('An Bot')).toBeTruthy()
  })
})

describe('thread', () => {
  const thread = [
    msg({ id: 'm1', sender_kind: 'user', text: 'Cần giúp', attachments: [{ type: 'image' }] }),
    msg({ id: 'm2', sender_kind: 'system', text: null, event: { code: 'handoff', reason: 'keyword', keyword: 'giúp' } }),
    msg({ id: 'm3', sender_kind: 'system', text: null, event: { code: 'future_code' } }),
    msg({ id: 'm4', sender_kind: 'bot', text: 'Bot trả lời', delivery_status: 'read' }),
    msg({ id: 'm5', sender_kind: 'admin', text: 'Admin trả lời', delivery_status: 'failed', delivery_error: 'outside window' }),
  ]

  it('renders bubbles, delivery state, attachments and system events', async () => {
    renderTab(fakeData({ loadMessages: vi.fn(async () => thread) }))
    fireEvent.click(await screen.findByText('Bình Cần'))
    const log = await screen.findByRole('list', { name: t('inbox.thread', { name: 'Bình Cần' }) })
    await within(log).findByText('Cần giúp')
    expect([...within(log).getByText('Cần giúp').closest('li')!.classList]).toEqual(expect.arrayContaining(['im-user']))
    expect(within(log).getByText(t('inbox.attachment.image'))).toBeTruthy()
    expect([...within(log).getByText('Bot trả lời').closest('li')!.classList]).toEqual(expect.arrayContaining(['im-bot']))
    expect(within(log).getByText(t('inbox.delivery.read'))).toBeTruthy()
    const failed = within(log).getByText(t('inbox.delivery.failed'))
    expect([...failed.closest('li')!.classList]).toEqual(expect.arrayContaining(['im-admin', 'is-failed']))
    expect(failed.getAttribute('title')).toBe('outside window')
    expect([...within(log).getByText(`${t('inbox.event.handoff')} · ${t('inbox.reason.keywordNamed', { keyword: 'giúp' })}`).closest('li')!.classList]).toEqual(expect.arrayContaining(['ev', 'warn']))
    expect(within(log).getByText(t('inbox.event.other'))).toBeTruthy()
    // Incoming messages carry no delivery state.
    expect(within(log).getAllByText(/./, { selector: '.im-state' })).toHaveLength(2)
  })

  it('loads older messages with a cursor on the oldest one', async () => {
    const page = Array.from({ length: MESSAGE_PAGE }, (_, i) =>
      msg({ id: `n${String(i).padStart(2, '0')}`, text: `new ${i}`, created_at: `2026-11-10T09:${String(i).padStart(2, '0')}:00Z` }),
    )
    const older = [msg({ id: 'o1', text: 'oldest', created_at: '2026-11-09T00:00:00Z' })]
    const loadMessages = vi.fn(async (_id: string, before?: unknown) => (before ? older : page))
    renderTab(fakeData({ loadMessages }))
    fireEvent.click(await screen.findByText('An Bot'))
    fireEvent.click(await screen.findByRole('button', { name: t('inbox.loadOlder') }))
    expect(await screen.findByText('oldest')).toBeTruthy()
    expect(loadMessages).toHaveBeenLastCalledWith('c-bot', { createdAt: page[0].created_at, id: 'n00' })
    // A short page means there is nothing older.
    expect(screen.queryByRole('button', { name: t('inbox.loadOlder') })).toBeNull()
  })

  it('switches between list and thread panes and opens customer details', async () => {
    renderTab(fakeData())
    fireEvent.click(await screen.findByText('An Bot'))
    const grid = document.querySelector('.ib-grid')!
    expect(grid.getAttribute('data-pane')).toBe('thread')
    fireEvent.click(screen.getByRole('button', { name: t('inbox.details') }))
    const dialog = screen.getByRole('dialog', { name: t('inbox.details') })
    expect(within(dialog).getByText('psid-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('inbox.back') }))
    await waitFor(() => expect(grid.getAttribute('data-pane')).toBe('list'))
  })
})

describe('customer panel', () => {
  // Pretends the window is wide enough for the third column.
  const wide = () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('min-width'), addEventListener() {}, removeEventListener() {} }))
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows profile and stats in a third column on wide screens', async () => {
    wide()
    renderTab(fakeData())
    fireEvent.click(await screen.findByText('An Bot'))
    const panel = screen.getByRole('complementary', { name: t('inbox.ctx.title') })
    expect(await within(panel).findByText(t('inbox.ctx.lang.vi'))).toBeTruthy()
    expect(within(panel).getByText('psid-1')).toBeTruthy()
    expect(within(panel).getByText(t('inbox.ctx.handoffs')).previousElementSibling!.textContent).toBe('2')
    expect(within(panel).getByLabelText(t('inbox.ctx.notes'))).toHaveProperty('value', 'Hỏi về Data Engineer')
    // The drawer button is only for narrow screens.
    expect(screen.queryByRole('button', { name: t('inbox.details') })).toBeNull()
  })

  it('autosaves notes after a pause and saves a pending edit when switching conversation', async () => {
    wide()
    const data = fakeData()
    renderTab(data)
    fireEvent.click(await screen.findByText('An Bot'))
    const notes = await screen.findByLabelText(t('inbox.ctx.notes'))
    vi.useFakeTimers()
    fireEvent.change(notes, { target: { value: 'a' } })
    fireEvent.change(notes, { target: { value: 'ab' } })
    expect(data.saveNotes).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(NOTES_DEBOUNCE_MS))
    expect(data.saveNotes).toHaveBeenCalledExactlyOnceWith('c-bot', 'ab')
    vi.useRealTimers()
    expect(await screen.findByText(t('inbox.ctx.saved'))).toBeTruthy()

    fireEvent.change(notes, { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('Bình Cần'))
    await waitFor(() => expect(data.saveNotes).toHaveBeenLastCalledWith('c-bot', 'abc'))
    expect(data.loadDetails).toHaveBeenLastCalledWith('c-needs')
  })

  it('shows a retry when a note does not save', async () => {
    wide()
    const saveNotes = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined)
    renderTab(fakeData({ saveNotes }))
    fireEvent.click(await screen.findByText('An Bot'))
    const notes = await screen.findByLabelText(t('inbox.ctx.notes'))
    fireEvent.change(notes, { target: { value: 'x' } })
    fireEvent.blur(notes)
    fireEvent.click(await screen.findByRole('button', { name: t('inbox.ctx.saveRetry') }))
    expect(await screen.findByText(t('inbox.ctx.saved'))).toBeTruthy()
    expect(saveNotes).toHaveBeenCalledTimes(2)
  })

  it('explains bot replies from their trace and shows — for missing fields', async () => {
    const loadMessages = vi.fn(async () => [
      msg({ id: 'b1', sender_kind: 'bot', text: 'Có ạ', trace: { provider: 'openai', model: 'gpt-x', latencyMs: 880 } }),
      msg({ id: 'b2', sender_kind: 'bot', text: 'Cũ', trace: null }),
    ])
    renderTab(fakeData({ loadMessages }))
    fireEvent.click(await screen.findByText('An Bot'))
    const reply = (await screen.findByText('Có ạ')).closest('li')!
    expect(within(reply).getByText(/openai · gpt-x/)).toBeTruthy()
    expect(within(reply).getByText(t('inbox.trace.latencyMs', { n: '880' }))).toBeTruthy()
    expect(within(reply).getByText(t('inbox.trace.tokens')).nextElementSibling!.textContent).toBe('—')
    // Old rows have no trace and no expander.
    expect(within(screen.getByText('Cũ').closest('li')!).queryByText(t('inbox.trace.why'))).toBeNull()
  })
})
