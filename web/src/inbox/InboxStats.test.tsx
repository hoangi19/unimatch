import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider, translate, type MessageKey } from '../i18n'
import type { InboxStats as Stats } from './data'
import { liveData } from './fixture'
import { InboxStats, LIVE_DEBOUNCE_MS } from './InboxStats'

const t = (key: MessageKey, params?: Record<string, string | number>) => translate('vi', key, params)
const STATS: Stats = { open_conversations: 12, waiting_for_human: 2, customer_conversations: 8, bot_handled: 6, avg_first_response_seconds: 1.8 }

const value = (label: MessageKey) => screen.getByText(t(label)).nextElementSibling?.textContent
const setup = (loadStats = vi.fn(async (): Promise<Stats> => STATS), pageId?: string) => {
  const live = liveData({ loadStats })
  render(
    <I18nProvider>
      <InboxStats data={live.data} pageId={pageId} />
    </I18nProvider>,
  )
  return { ...live, loadStats }
}

afterEach(() => vi.useRealTimers())

describe('InboxStats', () => {
  it('shows the four numbers for the chosen Page and flags waiting customers', async () => {
    const { loadStats } = setup(undefined, 'p1')
    expect(await screen.findByText('12')).toBeTruthy()
    expect(loadStats).toHaveBeenCalledWith('p1')
    expect(value('inboxStats.botPct')).toBe('75%')
    expect(value('inboxStats.firstResponse')).toBe(t('inboxStats.seconds', { n: '1,8' }))
    expect(value('inboxStats.waiting')).toBe('2')
    expect(screen.getByText(t('inboxStats.waiting')).closest('.ib-stat')?.classList.contains('warn')).toBe(true)
  })

  it('shows a dash when there is nothing to measure', async () => {
    setup(vi.fn(async () => ({ ...STATS, customer_conversations: 0, bot_handled: 0, avg_first_response_seconds: null, waiting_for_human: 0 })))
    expect(await screen.findByText('12')).toBeTruthy()
    expect(value('inboxStats.botPct')).toBe('—')
    expect(value('inboxStats.firstResponse')).toBe('—')
    expect(screen.getByText(t('inboxStats.waiting')).closest('.ib-stat')?.classList.contains('warn')).toBe(false)
  })

  it('refetches once after a burst of live events and every minute, keeping numbers on failure', async () => {
    vi.useFakeTimers()
    const loadStats = vi.fn(async (): Promise<Stats> => STATS)
    const { emit } = setup(loadStats)
    await act(async () => {})
    expect(loadStats).toHaveBeenCalledTimes(1)

    act(() => {
      emit({ type: 'resync' })
      emit({ type: 'resync' })
    })
    await act(async () => vi.advanceTimersByTime(LIVE_DEBOUNCE_MS))
    expect(loadStats).toHaveBeenCalledTimes(2)

    loadStats.mockRejectedValueOnce(new Error('offline'))
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(loadStats).toHaveBeenCalledTimes(3)
    expect(screen.getByText('12')).toBeTruthy()
  })
})
