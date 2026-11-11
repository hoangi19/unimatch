import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { ToastProvider } from '../ui/ToastProvider'
import { PAGE_SIZE, type DatasetData, type JobDetail, type JobQuery } from './data'
import { DatasetTab } from './DatasetTab'
import { RUN_STEP_PCT, RUN_TICK_MS } from './mock'

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

const job = (i: number, patch: Partial<JobDetail> = {}): JobDetail => ({
  source: i % 4 === 0 ? 'facebook_group' : 'linkedin',
  external_id: String(1000 + i),
  source_name: null,
  title: `Job ${i}`,
  company_name: `Company ${i}`,
  location: 'Hà Nội',
  salary: '30k/h',
  employment_type: i % 2 ? 'Part-time' : 'Full-time',
  seniority_level: 'Entry level',
  industries: null,
  description_text: `Line one ${i}\nLine two`,
  link: `https://example.com/jobs/${i}`,
  apply_url: null,
  applicants_count: null,
  benefits: [],
  posted_at: '2026-11-10',
  scraped_at: null,
  contact: `Zalo 09${i}`,
  poster_name: null,
  poster_title: null,
  poster_url: null,
  ...patch,
})

const JOBS = [job(1, { title: 'Nhân viên bảo vệ ca đêm' }), ...Array.from({ length: 29 }, (_, i) => job(i + 2))]

const matches = (j: JobDetail, q: JobQuery) =>
  (!q.q || `${j.title} ${j.company_name} ${j.description_text}`.toLowerCase().includes(q.q.toLowerCase())) &&
  (!q.source || j.source === q.source) &&
  (!q.type || j.employment_type === q.type) &&
  (!q.seniority || j.seniority_level === q.seniority)

function fakeData(patch: Partial<DatasetData> = {}) {
  const data: DatasetData = {
    loadStats: vi.fn(async () => ({ total: 98, bySource: { linkedin: 75, facebook_group: 23 }, recent: 4 })),
    loadJobs: vi.fn(async (q: JobQuery, offset: number) => {
      const all = JOBS.filter((j) => matches(j, q))
      return { rows: all.slice(offset, offset + PAGE_SIZE), total: all.length }
    }),
    loadJob: vi.fn(async (_source: string, id: string) => JOBS.find((j) => j.external_id === id)!),
    loadFacets: vi.fn(async () => ({ types: ['Full-time', 'Part-time'], seniorities: ['Entry level'] })),
    ...patch,
  }
  return data
}

const renderTab = (data: DatasetData) =>
  render(
    <I18nProvider>
      <ToastProvider>
        <DatasetTab data={data} />
      </ToastProvider>
    </I18nProvider>,
  )

const table = () => screen.getByRole('table', { name: 'Tin tuyển dụng' })

it('shows the counts and the first page, without contact data in the table', async () => {
  renderTab(fakeData())
  expect(await screen.findByText('98')).toBeTruthy()
  expect(screen.getByText('75')).toBeTruthy()
  expect(screen.getByText('23')).toBeTruthy()
  await screen.findByText('Nhân viên bảo vệ ca đêm')
  expect(within(table()).getAllByRole('row')).toHaveLength(1 + PAGE_SIZE + 1)
  expect(screen.getByText('25/30 việc làm')).toBeTruthy()
  expect(table().textContent).not.toContain('Zalo')
})

it('searches after a pause, filters by source and clears back to the full list', async () => {
  const data = fakeData()
  renderTab(data)
  await screen.findByText('Nhân viên bảo vệ ca đêm')

  fireEvent.change(screen.getByLabelText('Tìm việc làm'), { target: { value: 'bảo vệ' } })
  await waitFor(() => expect(within(table()).getAllByRole('row')).toHaveLength(2))
  expect(data.loadJobs).toHaveBeenLastCalledWith({ q: 'bảo vệ', source: '', type: '', seniority: '' }, 0)

  fireEvent.change(screen.getByLabelText('Nguồn'), { target: { value: 'facebook_group' } })
  expect(await screen.findByText('Không có việc làm nào khớp bộ lọc')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Xoá bộ lọc' }))
  await screen.findByText('25/30 việc làm')
  expect(data.loadJobs).toHaveBeenLastCalledWith({ q: '', source: '', type: '', seniority: '' }, 0)
})

it('loads the next page on demand', async () => {
  renderTab(fakeData())
  fireEvent.click(await screen.findByRole('button', { name: /Xem thêm 5 việc/ }))
  await screen.findByText('30/30 việc làm')
  expect(screen.queryByRole('button', { name: /Xem thêm/ })).toBeNull()
})

it('opens a read-only drawer with safe links, line breaks and contact info', async () => {
  const data = fakeData()
  renderTab(data)
  fireEvent.click(await screen.findByRole('row', { name: /Nhân viên bảo vệ ca đêm/ }))
  const drawer = screen.getByRole('dialog', { name: 'Nhân viên bảo vệ ca đêm' })
  const link = await within(drawer).findByRole('link', { name: /Mở tin gốc/ })
  expect(link.getAttribute('href')).toBe('https://example.com/jobs/1')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  expect(within(drawer).getByText(/Line one 1/).textContent).toBe('Line one 1\nLine two')
  expect(within(drawer).getByText('Zalo 091')).toBeTruthy()
  expect(within(drawer).getByText('Demo')).toBeTruthy()
  expect(data.loadJob).toHaveBeenCalledWith('linkedin', '1001')
})

it('drops links that are not http(s)', async () => {
  const data = fakeData({ loadJob: vi.fn(async () => job(1, { link: 'javascript:alert(1)' })) })
  renderTab(data)
  fireEvent.click(await screen.findByRole('row', { name: /Nhân viên bảo vệ ca đêm/ }))
  const drawer = screen.getByRole('dialog')
  await within(drawer).findByText('Zalo 091')
  expect(within(drawer).queryByRole('link')).toBeNull()
})

it('shows an error with a retry when the jobs cannot load', async () => {
  const loadJobs = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ rows: [], total: 0 })
  renderTab(fakeData({ loadJobs }))
  expect(await screen.findByText('Không tải được việc làm')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'Thử lại' })[0])
  expect(await screen.findByText('Chưa có việc làm')).toBeTruthy()
})

it('runs a demo crawl locally and never touches the data source', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const data = fakeData()
  renderTab(data)
  await screen.findByText('Nhân viên bảo vệ ca đêm')
  const calls = () => Object.values(data).reduce((n, fn) => n + (fn as ReturnType<typeof vi.fn>).mock.calls.length, 0)
  const before = calls()

  fireEvent.click(screen.getAllByRole('button', { name: 'Chạy ngay' })[0])
  expect(screen.getByRole('progressbar', { name: 'Tiến độ crawl' })).toBeTruthy()
  // One timer per tick, scheduled after each render.
  for (let i = 0; i < 100 / RUN_STEP_PCT + 1; i++)
    await act(async () => {
      vi.advanceTimersByTime(RUN_TICK_MS)
    })
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.getByText('Đã chạy xong Part-time · Hanoi')).toBeTruthy()
  expect(calls()).toBe(before)
})
