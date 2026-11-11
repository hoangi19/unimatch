import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { I18nProvider, translate, type MessageKey } from '../i18n'
import { ToastProvider } from '../ui/ToastProvider'
import { MESSAGE_PAGE, type InboxData } from './data'
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

const fakeLive = (patch: Partial<InboxData> = {}) =>
  liveData({ loadPages: vi.fn(async () => PAGES), loadConversations: vi.fn(async () => CONVERSATIONS), ...patch })
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
