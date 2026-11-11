import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { FacebookLoginError } from '../lib/facebook'
import { ToastProvider } from '../ui/ToastProvider'
import { pageStatus, type PageRow, type PagesData } from './data'
import { PagesTab } from './PagesTab'

beforeAll(() => {
  // jsdom has no <dialog> methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
  }
})
afterEach(() => vi.useRealTimers())

const DAY = 86_400_000
const row = (patch: Partial<PageRow> = {}): PageRow => ({
  id: 'p1',
  name: 'Page One',
  picture_url: null,
  bot_enabled: true,
  token_expires_at: null,
  access_token_secret_id: 'secret-id',
  reply_mode: 'always',
  reply_hours: {},
  handoff_keywords: [],
  reply_delay_ms: 0,
  ...patch,
})

function fakeData(rows: PageRow[], patch: Partial<PagesData> = {}) {
  const data: PagesData = {
    loadRows: vi.fn(async () => rows),
    updatePage: vi.fn(async () => undefined),
    loadSdk: vi.fn(async () => undefined),
    login: vi.fn(async () => 'user-token'),
    listPages: vi.fn(async () => ({ ok: true as const, pages: [] })),
    connectPage: vi.fn(async () => ({ ok: true as const, page: { id: 'x', name: 'x', pictureUrl: null, tasks: [] } })),
    disconnectPage: vi.fn(async () => ({ ok: true as const })),
    webhookUrl: 'https://example.supabase.co/functions/v1/meta-webhook',
    ...patch,
  }
  return data
}

const renderTab = (data: PagesData) =>
  render(
    <I18nProvider>
      <ToastProvider>
        <PagesTab data={data} />
      </ToastProvider>
    </I18nProvider>,
  )

describe('pageStatus', () => {
  const now = Date.parse('2026-11-12T00:00:00Z')
  it('reads the token state', () => {
    expect(pageStatus({ access_token_secret_id: null, token_expires_at: null }, now).kind).toBe('disconnected')
    expect(pageStatus({ access_token_secret_id: 's', token_expires_at: null }, now)).toEqual({ kind: 'ok', daysLeft: null })
    expect(pageStatus({ access_token_secret_id: 's', token_expires_at: new Date(now).toISOString() }, now).kind).toBe('expired')
    expect(pageStatus({ access_token_secret_id: 's', token_expires_at: new Date(now + 3 * DAY - 1000).toISOString() }, now)).toEqual({ kind: 'ok', daysLeft: 3 })
  })
})

describe('PagesTab', () => {
  it('shows the empty state with a connect button, and the webhook card without the verify token value', async () => {
    renderTab(fakeData([]))
    expect(await screen.findByText('Chưa kết nối Trang nào')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Kết nối Trang' })).toBeTruthy()
    expect((screen.getByLabelText('Callback URL') as HTMLInputElement).value).toMatch(/\/functions\/v1\/meta-webhook$/)
    expect(screen.getByText('Đã cấu hình trên máy chủ')).toBeTruthy()
    expect(screen.getByText('message_echoes')).toBeTruthy()
  })

  it('shows a load error with retry', async () => {
    const data = fakeData([], { loadRows: vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue([row()]) })
    renderTab(data)
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('Page One')).toBeTruthy()
  })

  it('warns about expired, expiring and disconnected tokens', async () => {
    renderTab(
      fakeData([
        row({ id: 'a', name: 'Expired', token_expires_at: new Date(Date.now() - 1000).toISOString() }),
        row({ id: 'b', name: 'Expiring', token_expires_at: new Date(Date.now() + 2 * DAY).toISOString() }),
        row({ id: 'c', name: 'Gone', access_token_secret_id: null }),
      ]),
    )
    expect(await screen.findByText('Facebook không còn chấp nhận token của Trang này.')).toBeTruthy()
    expect(screen.getByText('Token của Trang hết hạn ngày kia.')).toBeTruthy()
    expect(screen.getByText('Đã ngắt kết nối')).toBeTruthy()
    // A disconnected Page can be reconnected, not disconnected again.
    expect(screen.queryByRole('button', { name: 'Ngắt kết nối Gone' })).toBeNull()
  })

  it('saves the bot switch at once and rolls back on failure', async () => {
    const data = fakeData([row()], { updatePage: vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined) })
    renderTab(data)
    const toggle = (await screen.findByRole('switch', { name: 'Tự động trả lời' })) as HTMLInputElement
    fireEvent.click(toggle)
    expect(data.updatePage).toHaveBeenCalledWith('p1', { bot_enabled: false })
    await waitFor(() => expect(toggle.checked).toBe(true))
    fireEvent.click(toggle)
    await screen.findByText('Đã tắt tự động trả lời cho Page One')
    expect(toggle.checked).toBe(false)
  })

  it('shows the save bar for edits, focuses the first invalid field, then saves the contract shape', async () => {
    const data = fakeData([row()])
    renderTab(data)
    fireEvent.click(await screen.findByRole('button', { name: /Cài đặt trả lời/ }))
    const bar = screen.getByRole('region', { name: 'Thay đổi chưa lưu' })
    expect(bar.className).not.toContain('show')

    fireEvent.click(screen.getByLabelText('Giờ làm việc'))
    fireEvent.change(screen.getByLabelText('Đến'), { target: { value: '07:00' } })
    expect(bar.className).toContain('show')
    fireEvent.click(within(bar).getByRole('button', { name: 'Lưu thay đổi' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Đến'))
    expect(screen.getByText('Giờ kết thúc phải sau giờ bắt đầu.')).toBeTruthy()
    expect(data.updatePage).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Đến'), { target: { value: '17:00' } })
    fireEvent.change(screen.getByLabelText('Từ khóa chuyển nhân viên'), { target: { value: 'nhân viên, human' } })
    fireEvent.change(screen.getByLabelText('Độ trễ trả lời'), { target: { value: '4' } })
    fireEvent.click(within(bar).getByRole('button', { name: 'Lưu thay đổi' }))
    await screen.findByText('Đã lưu cài đặt trả lời')
    const range = [['08:00', '17:00']]
    expect(data.updatePage).toHaveBeenCalledWith('p1', {
      reply_mode: 'hours',
      reply_hours: { tz: 'Asia/Ho_Chi_Minh', days: { mon: range, tue: range, wed: range, thu: range, fri: range, sat: [], sun: [] } },
      handoff_keywords: ['nhân viên', 'human'],
      reply_delay_ms: 4000,
    })
    expect(bar.className).not.toContain('show')
  })

  it('discards edits', async () => {
    renderTab(fakeData([row()]))
    fireEvent.click(await screen.findByRole('button', { name: /Cài đặt trả lời/ }))
    fireEvent.click(screen.getByLabelText('Giờ làm việc'))
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }))
    expect((screen.getByLabelText('Luôn bật') as HTMLInputElement).checked).toBe(true)
  })

  it('disconnects after the undo window, and Undo cancels it', async () => {
    const data = fakeData([row()])
    renderTab(data)
    await screen.findByText('Page One')
    vi.useFakeTimers()
    const confirmDisconnect = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ngắt kết nối Page One' }))
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ngắt kết nối' }))
    }

    confirmDisconnect()
    expect(screen.getByText('Đang ngắt kết nối…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }))
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(data.disconnectPage).not.toHaveBeenCalled()

    confirmDisconnect()
    await act(() => vi.advanceTimersByTimeAsync(4900))
    expect(data.disconnectPage).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(data.disconnectPage).toHaveBeenCalledWith('p1')
  })

  it('disconnects at once when the tab closes during the undo window', async () => {
    const data = fakeData([row()])
    const { unmount } = renderTab(data)
    fireEvent.click(await screen.findByRole('button', { name: 'Ngắt kết nối Page One' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ngắt kết nối' }))
    unmount()
    expect(data.disconnectPage).toHaveBeenCalledWith('p1')
  })
})

describe('ConnectModal', () => {
  const summary = (id: string, tasks = ['MESSAGING']) => ({ id, name: `Page ${id}`, pictureUrl: null, tasks })

  it('shows bad_config clearly and keeps the button', async () => {
    const data = fakeData([], { listPages: vi.fn(async () => ({ ok: false as const, error: { kind: 'bad_config' as const, message: '' } })) })
    renderTab(data)
    fireEvent.click(await screen.findByRole('button', { name: 'Kết nối Trang' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục với Facebook' }))
    expect((await screen.findByRole('alert')).textContent).toContain('thiếu app secret')
    expect(screen.getByRole('button', { name: 'Tiếp tục với Facebook' })).toBeTruthy()
  })

  it('reports a cancelled login', async () => {
    renderTab(fakeData([], { login: vi.fn().mockRejectedValue(new FacebookLoginError('cancelled', 'x')) }))
    fireEvent.click(await screen.findByRole('button', { name: 'Kết nối Trang' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục với Facebook' }))
    expect((await screen.findByRole('alert')).textContent).toContain('đã hủy')
  })

  it('needs a Page and the messaging task, then connects and reloads', async () => {
    const data = fakeData([row({ id: 'p1', name: 'Page p1' })], {
      listPages: vi.fn(async () => ({ ok: true as const, pages: [summary('p1'), summary('p2'), summary('p3', ['ANALYZE'])] })),
    })
    renderTab(data)
    fireEvent.click(await screen.findByRole('button', { name: 'Kết nối Trang' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục với Facebook' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect((dialog.getByLabelText(/Page p1/) as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(dialog.getByRole('button', { name: 'Tiếp tục' }))
    expect(dialog.getByRole('alert').textContent).toBe('Chọn ít nhất một Trang.')
    fireEvent.click(dialog.getByLabelText(/Page p3/))
    fireEvent.click(dialog.getByRole('button', { name: 'Tiếp tục' }))
    expect(dialog.getByRole('alert').textContent).toContain('Page p3')

    fireEvent.click(dialog.getByLabelText(/Page p3/))
    fireEvent.click(dialog.getByLabelText(/Page p2/))
    fireEvent.click(dialog.getByRole('button', { name: 'Tiếp tục' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Kết nối 1 Trang' }))
    expect(await dialog.findByText('Đã kết nối 1 Trang')).toBeTruthy()
    expect(data.connectPage).toHaveBeenCalledWith('user-token', 'p2')
    expect(data.loadRows).toHaveBeenCalledTimes(2)
  })

  it('reconnect preselects the Page and shows per-Page failures', async () => {
    const data = fakeData([row({ id: 'p1', name: 'Page p1' })], {
      listPages: vi.fn(async () => ({ ok: true as const, pages: [summary('p1')] })),
      connectPage: vi.fn(async () => ({ ok: false as const, error: { kind: 'permission_denied' as const, message: '' } })),
    })
    renderTab(data)
    fireEvent.click(await screen.findByRole('button', { name: 'Kết nối lại Page p1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục với Facebook' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect((dialog.getByLabelText(/Page p1/) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(dialog.getByRole('button', { name: 'Tiếp tục' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Kết nối 1 Trang' }))
    expect((await dialog.findByRole('alert')).textContent).toContain('Page p1: Facebook chưa cấp đủ quyền')
  })
})
