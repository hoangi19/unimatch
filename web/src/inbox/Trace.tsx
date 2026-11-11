import { useI18n } from '../i18n'
import { Icon } from '../ui/Icon'
import { parseTrace, reasonText } from './data'
import type { Json } from '../lib/database.types'

const HOURS = ['always', 'open', 'closed', 'invalid'] as const
const NONE = '—'

/** "Why did the bot reply this way" under a bot bubble. Renders nothing for rows without a trace. */
export function Trace({ trace: raw }: { trace: Json | null }) {
  const { t, fmt } = useI18n()
  const trace = parseTrace(raw)
  if (!trace) return null
  const n = (v: number | undefined) => (v === undefined ? NONE : fmt.number(v))
  const handoff = trace.handoff && reasonText(t, trace.handoff)
  const hours = trace.hours && ((HOURS as readonly string[]).includes(trace.hours) ? t(`inbox.trace.hours.${trace.hours as (typeof HOURS)[number]}`) : trace.hours)
  const summary = trace.fallback ? t('inbox.trace.fallbackUsed') : handoff || [trace.provider, trace.model].filter(Boolean).join(' · ') || NONE
  const rows: [string, string][] = [
    [t('inbox.trace.provider'), trace.provider ?? NONE],
    [t('inbox.trace.model'), trace.model ?? NONE],
    [t('inbox.trace.latency'), trace.latencyMs === undefined ? NONE : t('inbox.trace.latencyMs', { n: n(trace.latencyMs) })],
    [t('inbox.trace.tokens'), trace.tokens ? `${n(trace.tokens.input)} / ${n(trace.tokens.output)}` : NONE],
    [t('inbox.trace.hours'), hours ?? NONE],
    [t('inbox.trace.rate'), trace.rate ? `${n(trace.rate.used)} / ${n(trace.rate.limit)}` : NONE],
    [t('inbox.trace.handoff'), handoff ?? NONE],
    [t('inbox.trace.fallback'), trace.fallback ?? NONE],
  ]
  return (
    <details className="debug">
      <summary>
        <Icon name="search" />
        <span>
          <strong className="why-label">{t('inbox.trace.why')}</strong> · {summary}
        </span>
        <Icon name="chevron-down" className="ic chev" />
      </summary>
      <dl className="debug-body trace-dl">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
