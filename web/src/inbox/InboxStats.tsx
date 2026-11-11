import { useEffect, useState } from 'react'
import { useI18n, type Translate } from '../i18n'
import { Icon, type IconName } from '../ui/Icon'
import type { InboxData, InboxStats as Stats } from './data'

const REFRESH_MS = 60_000
/** Live events come in bursts (a message plus its conversation update), so they share one refetch. */
export const LIVE_DEBOUNCE_MS = 2_000

/** Today's numbers above the Inbox: refetched on live events and every minute. */
export function InboxStats({ data, pageId }: { data: InboxData; pageId?: string }) {
  const { t, lang } = useI18n()
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

  const num = new Intl.NumberFormat(lang)
  const none = '—'
  const items: [IconName, string, string, boolean?][] = [
    ['inbox', t('inboxStats.open'), stats ? num.format(stats.open_conversations) : none],
    [
      'bot',
      t('inboxStats.botPct'),
      stats?.customer_conversations
        ? new Intl.NumberFormat(lang, { style: 'percent' }).format(stats.bot_handled / stats.customer_conversations)
        : none,
    ],
    ['clock', t('inboxStats.firstResponse'), stats?.avg_first_response_seconds != null ? duration(stats.avg_first_response_seconds, t, lang) : none],
    ['user', t('inboxStats.waiting'), stats ? num.format(stats.waiting_for_human) : none, !!stats?.waiting_for_human],
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

function duration(seconds: number, t: Translate, lang: string) {
  const one = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 })
  if (seconds < 60) return t('inboxStats.seconds', { n: one.format(seconds) })
  if (seconds < 3600) return t('inboxStats.minutes', { n: Math.round(seconds / 60) })
  return t('inboxStats.hours', { n: one.format(seconds / 3600) })
}
