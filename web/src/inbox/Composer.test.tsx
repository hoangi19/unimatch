import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { I18nProvider, translate, type MessageKey } from '../i18n'
import { ToastProvider } from '../ui/ToastProvider'
import type { ConversationRow, InboxData, SendResult } from './data'
import { conv, liveData, msg } from './fixture'
import { InboxTab } from './InboxTab'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
  }
})

const t = (key: MessageKey, params?: Record<string, string | number>) => translate('vi', key, params)
const recent = () => new Date(Date.now() - 60_000).toISOString()

const fakeData = (conversation: ConversationRow, patch: Partial<InboxData> = {}): InboxData =>
  liveData({
    loadPages: vi.fn(async () => [{ id: 'p1', name: 'Page One' }]),
    loadConversations: vi.fn(async () => [conversation]),
    loadQuickReplies: vi.fn(async () => ['Chào bạn', 'Cảm ơn bạn']),
    ...patch,
  }).data

async function open(data: InboxData, name = 'Nguyễn Văn An') {
  render(
    <I18nProvider>
      <ToastProvider>
        <InboxTab data={data} />
      </ToastProvider>
    </I18nProvider>,
  )
  fireEvent.click(await screen.findByText(name, { selector: 'strong' }))
  return screen.findByRole('list', { name: t('inbox.thread', { name }) })
}

const box = () => screen.getByRole('textbox', { name: t('inbox.compose.label', { name: 'Nguyễn Văn An' }) })
const header = () => screen.getByRole('banner')

describe('status actions', () => {
  it('takes over from the hint bar and then shows the composer', async () => {
    const data = fakeData(conv({ status: 'needs_human', last_customer_message_at: recent() }))
    await open(data)
    expect(screen.getByText(t('inbox.compose.hintNeeds', { name: 'Nguyễn Văn An' }))).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /Trả lời/ })).toBeNull()
    const hint = document.querySelector<HTMLElement>('.ib-hintbar')!
    fireEvent.click(within(hint).getByRole('button', { name: t('inbox.compose.takeOver') }))
    await waitFor(() => expect(data.setMode).toHaveBeenCalledWith('c1', 'human'))
    expect(await screen.findByRole('textbox', { name: t('inbox.compose.label', { name: 'Nguyễn Văn An' }) })).toBeTruthy()
    expect(within(header()).getByRole('button', { name: t('inbox.compose.return') })).toBeTruthy()
    // The list badge follows.
    expect(within(document.querySelector<HTMLElement>('.conv-list')!).getByText(t('inbox.status.human'))).toBeTruthy()
  })

  it('returns to the bot, closes and reopens through setMode', async () => {
    const data = fakeData(conv({ status: 'human', last_customer_message_at: recent() }))
    await open(data)
    fireEvent.click(within(header()).getByRole('button', { name: t('inbox.compose.return') }))
    await within(header()).findByRole('button', { name: t('inbox.compose.takeOver') })
    expect(screen.getByText(t('inbox.compose.hintBot'))).toBeTruthy()

    fireEvent.click(within(header()).getByRole('button', { name: t('inbox.compose.closeAria') }))
    await within(header()).findByRole('button', { name: t('inbox.compose.reopenAria') })
    expect(screen.getByText(t('inbox.compose.hintClosed'))).toBeTruthy()

    fireEvent.click(within(header()).getByRole('button', { name: t('inbox.compose.reopenAria') }))
    await within(header()).findByRole('button', { name: t('inbox.compose.takeOver') })
    expect(vi.mocked(data.setMode).mock.calls.map((c) => c[1])).toEqual(['bot', 'closed', 'bot'])
  })

  it('keeps the status and says so when the change fails', async () => {
    const data = fakeData(conv({ status: 'bot' }), { setMode: vi.fn(async () => Promise.reject(new Error('nope'))) })
    await open(data)
    fireEvent.click(within(header()).getByRole('button', { name: t('inbox.compose.takeOver') }))
    expect(await screen.findByText(t('inbox.compose.modeFailed'))).toBeTruthy()
    expect(within(header()).getByRole('button', { name: t('inbox.compose.takeOver') })).toBeTruthy()
  })
})

describe('composer', () => {
  it('sends on Enter but not during an IME composition or with Shift', async () => {
    const stored = msg({ id: 'm-sent', sender_kind: 'admin', text: 'Chào bạn nhé', created_at: recent() })
    let sent = false
    const data = fakeData(conv({ status: 'human', last_customer_message_at: recent() }), {
      loadMessages: vi.fn(async () => (sent ? [stored] : [])),
      send: vi.fn(async (): Promise<SendResult> => {
        sent = true
        return { ok: true, messageId: 'm-sent' }
      }),
    })
    await open(data)
    fireEvent.change(box(), { target: { value: 'Chào bạn nhé' } })
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
    expect(data.send).not.toHaveBeenCalled()

    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(data.send).toHaveBeenCalledWith('c1', 'Chào bạn nhé', undefined)
    expect((box() as HTMLTextAreaElement).value).toBe('')
    // The optimistic bubble, then the stored row once it is synced, never both.
    await waitFor(() => expect(document.querySelectorAll('.im-admin').length).toBe(1))
    await waitFor(() => expect(data.loadMessages).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText('Chào bạn nhé')).toHaveLength(1)
    expect(screen.getByText(t('inbox.delivery.sent'))).toBeTruthy()
  })

  it('shows a sending bubble until the function answers', async () => {
    let answer: (r: SendResult) => void = () => {}
    const data = fakeData(conv({ status: 'human', last_customer_message_at: recent() }), {
      send: vi.fn(() => new Promise<SendResult>((resolve) => (answer = resolve))),
    })
    await open(data)
    fireEvent.change(box(), { target: { value: 'Đợi mình chút' } })
    fireEvent.click(screen.getByRole('button', { name: t('inbox.compose.send') }))
    expect(await screen.findByText(t('inbox.delivery.pending'))).toBeTruthy()
    answer({ ok: true, messageId: 'm-sent' })
    await waitFor(() => expect(screen.queryByText(t('inbox.delivery.pending'))).toBeNull())
  })

  it('retries a stored failed row with retry_of and a local one without', async () => {
    const failedRow = msg({ id: 'm-failed', sender_kind: 'admin', text: 'Lần đầu', delivery_status: 'failed', delivery_error: 'rate', created_at: recent() })
    const send = vi
      .fn<InboxData['send']>()
      .mockResolvedValueOnce({ ok: false, messageId: null, error: { kind: 'send_failed', message: 'network' } })
      .mockResolvedValue({ ok: true, messageId: 'm-sent' })
    const data = fakeData(conv({ status: 'human', last_customer_message_at: recent() }), { loadMessages: vi.fn(async () => [failedRow]), send })
    await open(data)

    // Nothing stored: a local failed bubble, retried without retry_of.
    fireEvent.change(box(), { target: { value: 'Lần hai' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(await screen.findByText(t('inbox.compose.error.send_failed'))).toBeTruthy()
    const retries = await screen.findAllByRole('button', { name: t('inbox.compose.retry') })
    expect(retries).toHaveLength(2)
    fireEvent.click(retries[1])
    await waitFor(() => expect(send).toHaveBeenLastCalledWith('c1', 'Lần hai', undefined))

    fireEvent.click(screen.getByRole('button', { name: t('inbox.compose.retry') }))
    await waitFor(() => expect(send).toHaveBeenLastCalledWith('c1', 'Lần đầu', 'm-failed'))
  })

  it('locks sending outside the 24-hour window', async () => {
    const old = new Date(Date.now() - 25 * 3600_000).toISOString()
    await open(fakeData(conv({ status: 'human', last_customer_message_at: old })))
    expect(screen.getByText(t('inbox.compose.window', { name: 'Nguyễn Văn An' }))).toBeTruthy()
    expect((box() as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('locks after an outside_window answer', async () => {
    const data = fakeData(conv({ status: 'human', last_customer_message_at: recent() }), {
      send: vi.fn(async (): Promise<SendResult> => ({ ok: false, messageId: null, error: { kind: 'outside_window', message: 'late' } })),
    })
    await open(data)
    fireEvent.change(box(), { target: { value: 'Chào' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(await screen.findByText(t('inbox.compose.window', { name: 'Nguyễn Văn An' }))).toBeTruthy()
    expect((box() as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('appends a quick reply to the draft and closes the list on Escape', async () => {
    await open(fakeData(conv({ status: 'human', last_customer_message_at: recent() })))
    const quick = await screen.findByRole('button', { name: t('inbox.compose.quick') })
    fireEvent.change(box(), { target: { value: 'Dạ' } })
    fireEvent.click(quick)
    fireEvent.click(screen.getByRole('button', { name: 'Cảm ơn bạn' }))
    expect((box() as HTMLTextAreaElement).value).toBe('Dạ Cảm ơn bạn')
    fireEvent.click(quick)
    expect(quick.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Chào bạn' }), { key: 'Escape' })
    expect(quick.getAttribute('aria-expanded')).toBe('false')
  })
})
