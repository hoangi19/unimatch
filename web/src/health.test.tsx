import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import App from './App'
import type { PageRow, PagesData } from './pages/data'
import { fakeSession, stubAuth } from './test-auth'

const row = (patch: Partial<PageRow>): PageRow => ({
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

// The shell needs only loadRows; loadSdk is for the Pages tab the banner opens.
const data = (rows: PageRow[]) => ({ loadRows: vi.fn(async () => rows), loadSdk: vi.fn(async () => undefined), webhookUrl: '' }) as unknown as PagesData

const renderApp = (rows: PageRow[]) => {
  history.replaceState(null, '', '/inbox')
  render(<App auth={stubAuth(fakeSession('admin')).auth} pagesData={data(rows)} />)
}

it('shows a reconnect banner and a failing status when a Page token is invalid', async () => {
  renderApp([row({ token_expires_at: '2020-01-01T00:00:00Z' }), row({ id: 'p2' }), row({ id: 'p3', access_token_secret_id: null })])
  const banner = await screen.findByRole('alert')
  expect(banner.textContent).toContain('Facebook không còn chấp nhận token của 1 Trang.')
  const strip = screen.getByRole('region', { name: 'Trạng thái hệ thống' })
  expect(within(strip).getByText('Token lỗi · 1/2 Trang')).toBeTruthy()

  fireEvent.click(within(banner).getByRole('button', { name: 'Kết nối lại' }))
  expect(location.pathname).toBe('/pages')
  expect(screen.queryByText(/Facebook không còn chấp nhận token của 1 Trang/)).toBeNull()
})

it('shows healthy Pages without a banner', async () => {
  renderApp([row({})])
  expect(await screen.findByText('Ổn định · 1 Trang')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('says when no Page is connected', async () => {
  renderApp([row({ access_token_secret_id: null })])
  expect(await screen.findByText('Chưa kết nối Trang')).toBeTruthy()
})
