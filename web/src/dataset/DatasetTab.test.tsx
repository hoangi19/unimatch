import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { ToastProvider } from '../ui/ToastProvider'
import { PAGE_SIZE, type DatasetData, type EmbeddingRow, type EmbedTestResult, type JobDetail, type JobQuery } from './data'
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

const EMBEDDING: EmbeddingRow = {
  provider: 'FPT AI Marketplace',
  base_url: 'https://mkp-api.fptcloud.com/v1',
  model: 'Vietnamese_Embedding',
  dims: 1024,
  key_hint: null,
  key_saved_at: null,
}

function fakeData(patch: Partial<DatasetData> = {}) {
  const data: DatasetData = {
    loadStats: vi.fn(async () => ({ total: 98, bySource: { linkedin: 75, facebook_group: 23 }, recent: 4, embedded: 61 })),
    loadJobs: vi.fn(async (q: JobQuery, offset: number) => {
      const all = JOBS.filter((j) => matches(j, q))
      return { rows: all.slice(offset, offset + PAGE_SIZE), total: all.length }
    }),
    loadJob: vi.fn(async (_source: string, id: string) => JOBS.find((j) => j.external_id === id)!),
    loadFacets: vi.fn(async () => ({ types: ['Full-time', 'Part-time'], seniorities: ['Entry level'] })),
    loadEmbedding: vi.fn(async () => ({ ...EMBEDDING })),
    saveEmbedding: vi.fn(async () => {}),
    testEmbedding: vi.fn(async (): Promise<EmbedTestResult> => ({ ok: true, model: 'Vietnamese_Embedding', dims: 1024, latencyMs: 85 })),
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
  // Real embedded count, from job_chunks.
  expect(screen.getByText('61')).toBeTruthy()
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

// Fake key, built at runtime so the secret scan does not flag a literal.
const FAKE_KEY = ['fpt', 'testkey', 'abcd12'].join('-')
const card = () => screen.getByRole('region', { name: 'Cài đặt embedding' })

it('saves the embedding connection and a new key, then shows only the hint', async () => {
  const data = fakeData()
  vi.mocked(data.loadEmbedding)
    .mockResolvedValueOnce({ ...EMBEDDING })
    .mockResolvedValueOnce({ ...EMBEDDING, model: 'Other_Embedding', key_hint: 'fpt-…cd12', key_saved_at: '2026-11-12T03:00:00Z' })
  renderTab(data)
  const model = await within(card()).findByLabelText('Model embedding')
  expect(within(card()).getByText('FPT AI Marketplace')).toBeTruthy()
  expect(within(card()).getByText('1.024 chiều')).toBeTruthy()

  fireEvent.change(model, { target: { value: ' Other_Embedding ' } })
  expect(within(card()).getByText(/cần re-index toàn bộ 98 việc làm/)).toBeTruthy()
  fireEvent.change(within(card()).getByLabelText('API key'), { target: { value: FAKE_KEY } })
  fireEvent.click(within(card()).getByRole('button', { name: 'Lưu' }))
  await waitFor(() => expect(data.saveEmbedding).toHaveBeenCalledWith({ model: 'Other_Embedding', key: FAKE_KEY }))
  expect(await within(card()).findByTestId('key-hint')).toBeTruthy()
  expect(card().textContent).not.toContain(FAKE_KEY)
})

it('blocks saving an invalid base URL or key', async () => {
  const data = fakeData()
  renderTab(data)
  const url = await within(card()).findByLabelText('Base URL')
  fireEvent.change(url, { target: { value: 'http://insecure.example.com' } })
  fireEvent.change(within(card()).getByLabelText('API key'), { target: { value: 'has space' } })
  fireEvent.click(within(card()).getByRole('button', { name: 'Lưu' }))
  expect(await within(card()).findByText('Nhập URL bắt đầu bằng https://.')).toBeTruthy()
  expect(within(card()).getByText('Key dài 8 đến 512 ký tự, không có khoảng trắng.')).toBeTruthy()
  expect(data.saveEmbedding).not.toHaveBeenCalled()
})

it('tests the saved embedding connection and reports a wrong vector size', async () => {
  const data = fakeData()
  renderTab(data)
  const button = await within(card()).findByRole('button', { name: 'Kiểm tra kết nối' })
  fireEvent.click(button)
  expect(await within(card()).findByText('Đã kết nối · 1.024 chiều · 85 ms')).toBeTruthy()

  vi.mocked(data.testEmbedding).mockResolvedValueOnce({ ok: false, error: { kind: 'bad_config', message: 'Embedding model returned 768 dims, expected 1024' } })
  fireEvent.click(button)
  expect(await within(card()).findByText('Embedding model returned 768 dims, expected 1024')).toBeTruthy()
})
