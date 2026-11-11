import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider, translate, type MessageKey } from '../i18n'
import { ToastProvider } from '../ui/ToastProvider'
import type { InboxData } from './data'
import { conv, liveData, msg } from './fixture'
import { InboxTab } from './InboxTab'
import { useUnreadTotal } from './useUnreadTotal'

const t = (key: MessageKey, params?: Record<string, string | number>) => translate('vi', key, params)

const CONVERSATIONS = [
  conv({ id: 'c-new', customer_name: 'An', last_message_at: '2026-11-11T10:00:00Z' }),
  conv({ id: 'c-old', customer_name: 'Bình', last_message_at: '2026-11-01T10:00:00Z', unread_count: 2 }),
]

const setup = (patch: Partial<InboxData> = {}) => {
  const live = liveData({ loadConversations: vi.fn(async () => CONVERSATIONS), ...patch })
  render(
    <I18nProvider>
      <ToastProvider>
        <InboxTab data={live.data} />
      </ToastProvider>
    </I18nProvider>,
  )
  return live
}

const rowIds = () => [...document.querySelectorAll('button.conv')].map((b) => b.id.slice('conv-'.length))
const unreadDot = (n: number) => screen.queryByRole('img', { name: t('inbox.unread', { n }) })

const setVisibility = (state: DocumentVisibilityState) => Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
afterEach(() => setVisibility('visible'))

describe('live conversation list', () => {
  it('moves a conversation with a new message to the top and shows its unread count', async () => {
    const { emit } = setup()
    await screen.findByText('An')
    expect(rowIds()).toEqual(['c-new', 'c-old'])

    act(() => emit({ type: 'conversation', row: { ...CONVERSATIONS[1], last_message_at: '2026-11-12T09:00:00Z', unread_count: 3 } }))
    expect(rowIds()).toEqual(['c-old', 'c-new'])
    expect(unreadDot(3)).not.toBeNull()

    act(() => emit({ type: 'conversation', row: conv({ id: 'c-first', customer_name: 'Chi', last_message_at: '2026-11-12T10:00:00Z' }) }))
    act(() => emit({ type: 'conversationDeleted', id: 'c-new' }))
    expect(rowIds()).toEqual(['c-first', 'c-old'])
  })

  it('refetches the list quietly when the connection comes back', async () => {
    const { data, emit } = setup()
    await screen.findByText('An')
    vi.mocked(data.loadConversations).mockResolvedValueOnce([conv({ id: 'c-missed', customer_name: 'Dũng' })])
    act(() => emit({ type: 'resync' }))
    await screen.findByText('Dũng')
    expect(rowIds()).toEqual(['c-missed'])
  })

  it('marks an opened conversation as read, and again when a message arrives while it is open', async () => {
    const { data, emit } = setup()
    fireEvent.click(await screen.findByText('Bình'))
    expect(data.markRead).toHaveBeenCalledWith('c-old')
    expect(unreadDot(2)).toBeNull()

    act(() => emit({ type: 'conversation', row: { ...CONVERSATIONS[1], unread_count: 1 } }))
    expect(data.markRead).toHaveBeenCalledTimes(2)
    expect(unreadDot(1)).toBeNull()
  })

  it('waits until the browser tab is visible before marking as read', async () => {
    setVisibility('hidden')
    const { data } = setup()
    fireEvent.click(await screen.findByText('Bình'))
    expect(data.markRead).not.toHaveBeenCalled()
    setVisibility('visible')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(data.markRead).toHaveBeenCalledWith('c-old')
  })
})

describe('live thread', () => {
  const openThread = async (live: ReturnType<typeof setup>) => {
    fireEvent.click(await screen.findByText('An'))
    await screen.findByText('Xin chào')
    const log = screen.getByRole('list', { name: t('inbox.thread', { name: 'An' }) })
    // jsdom does no layout: give the log a scrollable size.
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
    log.scrollTo = vi.fn()
    return { log, ...live }
  }
  const page = [msg({ id: 'm1', conversation_id: 'c-new' })]

  it('adds live messages for the open conversation only and follows them at the bottom', async () => {
    const { log, emit } = await openThread(setup({ loadMessages: vi.fn(async () => page) }))
    log.scrollTop = 700
    fireEvent.scroll(log)

    act(() => emit({ type: 'message', row: msg({ id: 'm-other', conversation_id: 'c-old', text: 'khác' }) }))
    act(() => emit({ type: 'message', row: msg({ id: 'm2', conversation_id: 'c-new', created_at: '2026-11-10T09:00:00Z', text: 'Còn việc không?' }) }))
    expect(screen.queryByText('khác')).toBeNull()
    expect(screen.getByText('Còn việc không?')).not.toBeNull()
    expect(log.scrollTop).toBe(1000)
    expect(screen.queryByRole('button', { name: t('inboxLive.newMessages') })).toBeNull()
  })

  it('keeps the view still while reading older messages and offers a jump to the new ones', async () => {
    const { log, emit } = await openThread(setup({ loadMessages: vi.fn(async () => page) }))
    log.scrollTop = 100
    fireEvent.scroll(log)

    act(() => emit({ type: 'message', row: msg({ id: 'm2', conversation_id: 'c-new', created_at: '2026-11-10T09:00:00Z' }) }))
    expect(log.scrollTop).toBe(100)
    fireEvent.click(screen.getByRole('button', { name: t('inboxLive.newMessages') }))
    expect(log.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1000 }))
    expect(screen.queryByRole('button', { name: t('inboxLive.newMessages') })).toBeNull()
  })

  it('shows a delivery update in place without the jump button', async () => {
    const { log, emit } = await openThread(
      setup({ loadMessages: vi.fn(async () => [msg({ id: 'm1', conversation_id: 'c-new', sender_kind: 'bot', delivery_status: 'sent' })]) }),
    )
    log.scrollTop = 100
    fireEvent.scroll(log)
    act(() => emit({ type: 'message', row: msg({ id: 'm1', conversation_id: 'c-new', sender_kind: 'bot', delivery_status: 'delivered' }) }))
    expect(screen.getByText(t('inbox.delivery.delivered'))).not.toBeNull()
    expect(screen.queryByRole('button', { name: t('inboxLive.newMessages') })).toBeNull()
  })
})

describe('useUnreadTotal', () => {
  it('sums unread counts, follows live rows and reloads on resync', async () => {
    const { data, emit } = liveData({ loadUnread: vi.fn(async () => [{ id: 'a', unread_count: 2 }, { id: 'b', unread_count: 1 }]) })
    const { result } = renderHook(() => useUnreadTotal(data))
    await waitFor(() => expect(result.current).toBe(3))

    act(() => emit({ type: 'conversation', row: conv({ id: 'a', unread_count: 0 }) }))
    act(() => emit({ type: 'conversation', row: conv({ id: 'c', unread_count: 4 }) }))
    expect(result.current).toBe(5)
    act(() => emit({ type: 'conversationDeleted', id: 'c' }))
    expect(result.current).toBe(1)

    vi.mocked(data.loadUnread).mockResolvedValueOnce([])
    act(() => emit({ type: 'resync' }))
    await waitFor(() => expect(result.current).toBe(0))
  })
})
