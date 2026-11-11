import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { Icon, type IconName } from '../ui/Icon'
import type { InboxData, InboxStats as Stats } from './data'

const REFRESH_MS = 60_000
/** Live events come in bursts (a message plus its conversation update), so they share one refetch. */
export const LIVE_DEBOUNCE_MS = 2_000

/** Today's numbers above the Inbox: refetched on live events and every minute. */
export function InboxStats({ data, pageId }: { data: InboxData; pageId?: string }) {
  const { t, fmt } = useI18n()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    let current = true
    let debounce: ReturnType<typeof setTimeout> | undefined
    // A failed refetch keeps the numbers already shown.
    const load = () => data.loadStats(pageId).then((s) => current && setStats(s), () => {})
    load()
    const timer = setInterval(load, REFRESH_MS)
    const unsubscribe = data.subscribe(() => {
      clearTimeout(debounce)
      debounce = setTimeout(load, LIVE_DEBOUNCE_MS)
    })
    return () => {
      current = false
      clearTimeout(debounce)
      clearInterval(timer)
      unsubscribe()
    }
  }, [data, pageId])

  const none = '—'
  const items: [IconName, string, string, boolean?][] = [
    ['inbox', t('inboxStats.open'), stats ? fmt.number(stats.open_conversations) : none],
    [
      'bot',
      t('inboxStats.botPct'),
      stats?.customer_conversations ? fmt.percent(stats.bot_handled / stats.customer_conversations) : none,
    ],
    ['clock', t('inboxStats.firstResponse'), stats?.avg_first_response_seconds != null ? fmt.duration(stats.avg_first_response_seconds) : none],
    ['user', t('inboxStats.waiting'), stats ? fmt.number(stats.waiting_for_human) : none, !!stats?.waiting_for_human],
  ]

  return (
    <dl className="ib-stats" aria-label={t('inboxStats.label')} aria-busy={!stats}>
      {items.map(([icon, label, value, warn]) => (
        <div key={icon} className={warn ? 'ib-stat warn' : 'ib-stat'}>
          <Icon name={icon} />
          <dt className="k">{label}</dt>
          <dd className="v">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
