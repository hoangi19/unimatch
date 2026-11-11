import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { Button, EmptyState, Skeleton } from '../ui/controls'
import { Icon, type IconName } from '../ui/Icon'
import { useToast } from '../ui/toast-context'
import {
  JOB_SOURCES,
  localDate,
  NO_QUERY,
  PAGE_SIZE,
  recentSince,
  type DatasetData,
  type Facets,
  type JobListRow,
  type JobQuery,
  type JobStats,
} from './data'
import { JobDrawer } from './JobDrawer'
import { DemoBadge, EmbedCard, HistoryCard, SourcesCard } from './MockCards'
import { SourceBadge } from './SourceBadge'
import { useMockCrawl } from './useMock'
import './dataset.css'

const SEARCH_DEBOUNCE_MS = 300
const COLUMNS = 6

type JobList = { rows: JobListRow[]; total: number }

export function DatasetTab({ data }: { data: DatasetData }) {
  const { t } = useI18n()
  const toast = useToast()
  const crawl = useMockCrawl()
  const [stats, setStats] = useState<JobStats | null | 'error'>(null)
  const [facets, setFacets] = useState<Facets>({ types: [], seniorities: [] })
  const [text, setText] = useState('')
  const [query, setQuery] = useState<JobQuery>(NO_QUERY)
  const [attempt, setAttempt] = useState(0)
  // A result belongs to one query and attempt; any other key means that list is still loading.
  const key = `${JSON.stringify(query)}#${attempt}`
  const [result, setResult] = useState<{ key: string; list: JobList | 'error' } | null>(null)
  const [moreKey, setMoreKey] = useState<string | null>(null)
  const [open, setOpen] = useState<JobListRow | null>(null)
  const list = result?.key === key ? result.list : null
  const loadingMore = moreKey === key
  // The key of the newest list request, so a slow answer for an old query is dropped.
  const latest = useRef(key)

  useEffect(() => {
    data.loadStats(recentSince(new Date())).then(setStats, () => setStats('error'))
    // The filters still work without their options; the error shows on the list if the table is unreadable.
    data.loadFacets().then(setFacets, () => undefined)
  }, [data, attempt])

  useEffect(() => {
    const timer = setTimeout(() => setQuery((q) => (q.q === text.trim() ? q : { ...q, q: text.trim() })), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  useEffect(() => {
    latest.current = key
    data.loadJobs(query, 0).then(
      (r) => latest.current === key && setResult({ key, list: r }),
      () => latest.current === key && setResult({ key, list: 'error' }),
    )
  }, [data, key, query])

  const retry = () => {
    setStats(null)
    setAttempt((n) => n + 1)
  }

  const loadMore = () => {
    if (!list || list === 'error') return
    setMoreKey(key)
    data.loadJobs(query, list.rows.length).then(
      (r) => {
        if (latest.current !== key) return
        setResult({ key, list: { rows: [...list.rows, ...r.rows], total: r.total } })
        setMoreKey(null)
      },
      () => {
        if (latest.current !== key) return
        setMoreKey(null)
        toast({ kind: 'error', title: t('dataset.jobs.moreFailed') })
      },
    )
  }

  const filtered = text.trim() !== '' || query.source !== '' || query.type !== '' || query.seniority !== ''
  const clear = () => {
    setText('')
    setQuery(NO_QUERY)
  }
  const total = stats && stats !== 'error' ? stats.total : 0

  return (
    <div className="ds">
      <div className="view-head">
        <div>
          <h2>{t('tab.dataset')}</h2>
          <p className="sub">{t('dataset.sub')}</p>
        </div>
      </div>

      <StatCards stats={stats} onRetry={retry} />

      <div className="section-title">
        <div>
          <h3>{t('dataset.jobs.title')}</h3>
          <p>{t('dataset.jobs.sub')}</p>
        </div>
      </div>
      <section className="card" aria-label={t('dataset.jobs.title')}>
        <Toolbar text={text} onText={setText} query={query} onQuery={setQuery} facets={facets} list={list} />
        {list && list !== 'error' && list.total === 0 && !filtered ? (
          <EmptyState icon="database" title={t('dataset.jobs.noneTitle')}>
            {t('dataset.jobs.noneBody')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <caption className="sr-only">{t('dataset.jobs.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('dataset.th.title')}</th>
                  <th scope="col" className="col-sm-hide">
                    {t('dataset.th.company')}
                  </th>
                  <th scope="col" className="col-sm-hide">
                    {t('dataset.th.location')}
                  </th>
                  <th scope="col">{t('dataset.th.source')}</th>
                  <th scope="col" className="col-sm-hide">
                    {t('dataset.th.salary')}
                  </th>
                  <th scope="col" className="col-sm-hide">
                    {t('dataset.th.posted')}
                  </th>
                </tr>
              </thead>
              <tbody>
                <JobRows
                  list={list}
                  filtered={filtered}
                  loadingMore={loadingMore}
                  onOpen={setOpen}
                  onMore={loadMore}
                  onClear={clear}
                  onRetry={retry}
                />
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="section-title">
        <div>
          <h3>{t('dataset.src.title')}</h3>
          <p>{t('dataset.src.sub')}</p>
        </div>
        <DemoBadge />
      </div>
      <SourcesCard crawl={crawl} />

      <div className="data-bottom">
        <EmbedCard total={total} />
        <HistoryCard crawl={crawl} />
      </div>

      <JobDrawer data={data} job={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function StatCards({ stats, onRetry }: { stats: JobStats | null | 'error'; onRetry: () => void }) {
  const { t, fmt } = useI18n()
  if (stats === 'error')
    return (
      <div className="callout callout-danger" role="alert">
        <Icon name="alert" />
        <div className="callout-body">{t('dataset.stat.error')}</div>
        <Button size="sm" onClick={onRetry}>
          {t('dataset.retry')}
        </Button>
      </div>
    )
  const share = (n: number) => (stats && stats.total ? t('dataset.stat.share', { pct: fmt.percent(n / stats.total) }) : '')
  const cards: [IconName, string, number | undefined, string][] = [
    ['database', t('dataset.stat.total'), stats?.total, t('dataset.stat.totalNote')],
    ['search', t('dataset.source.linkedin'), stats?.bySource.linkedin, share(stats?.bySource.linkedin ?? 0)],
    ['facebook', t('dataset.source.facebook_group'), stats?.bySource.facebook_group, share(stats?.bySource.facebook_group ?? 0)],
    ['clock', t('dataset.stat.recent'), stats?.recent, t('dataset.stat.recentNote')],
  ]
  return (
    <div className="stats">
      {cards.map(([icon, label, value, note]) => (
        <div key={label} className="card stat">
          <div className="k">
            <Icon name={icon} />
            {label}
          </div>
          <div className="v">{value === undefined ? <Skeleton width="40%" height={24} /> : fmt.number(value)}</div>
          <div className="d">{note}</div>
        </div>
      ))}
    </div>
  )
}

type ToolbarProps = {
  text: string
  onText: (text: string) => void
  query: JobQuery
  onQuery: (q: JobQuery) => void
  facets: Facets
  list: JobList | null | 'error'
}

function Toolbar({ text, onText, query, onQuery, facets, list }: ToolbarProps) {
  const { t, fmt } = useI18n()
  const id = useId()
  const select = (key: 'source' | 'type' | 'seniority', label: string, all: string, options: [string, string][]) => (
    <div className="field narrow">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <select id={`${id}-${key}`} className="input" value={query[key]} onChange={(e) => onQuery({ ...query, [key]: e.target.value })}>
        <option value="">{all}</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )
  const pairs = (values: string[]): [string, string][] => values.map((v) => [v, v])
  return (
    <div className="toolbar">
      <div className="field">
        <label htmlFor={`${id}-q`}>{t('dataset.jobs.search')}</label>
        <div className="input-with-icon">
          <Icon name="search" />
          <input
            id={`${id}-q`}
            className="input"
            type="search"
            placeholder={t('dataset.jobs.searchPh')}
            value={text}
            onChange={(e) => onText(e.target.value)}
          />
        </div>
      </div>
      {select(
        'source',
        t('dataset.jobs.source'),
        t('dataset.jobs.allSources'),
        JOB_SOURCES.map((s) => [s, t(`dataset.source.${s}`)]),
      )}
      {select('type', t('dataset.jobs.type'), t('dataset.jobs.allTypes'), pairs(facets.types))}
      {select('seniority', t('dataset.jobs.seniority'), t('dataset.jobs.allSeniorities'), pairs(facets.seniorities))}
      <span className="count" aria-live="polite">
        {list && list !== 'error' ? t('dataset.jobs.count', { a: fmt.number(list.rows.length), b: fmt.number(list.total) }) : list === null ? t('dataset.jobs.loading') : ''}
      </span>
    </div>
  )
}

type JobRowsProps = {
  list: JobList | null | 'error'
  filtered: boolean
  loadingMore: boolean
  onOpen: (job: JobListRow) => void
  onMore: () => void
  onClear: () => void
  onRetry: () => void
}

function JobRows({ list, filtered, loadingMore, onOpen, onMore, onClear, onRetry }: JobRowsProps) {
  const { t, fmt } = useI18n()
  if (list === null)
    return Array.from({ length: 6 }, (_, i) => (
      <tr key={i} aria-hidden="true">
        {Array.from({ length: COLUMNS }, (_, c) => (
          <td key={c} className={c === 0 || c === 3 ? undefined : 'col-sm-hide'}>
            <Skeleton width={`${70 - i * 5}%`} />
          </td>
        ))}
      </tr>
    ))
  if (list === 'error')
    return (
      <tr>
        <td colSpan={COLUMNS}>
          <div className="table-empty" role="alert">
            <Icon name="alert" />
            <strong>{t('dataset.jobs.errorTitle')}</strong>
            <span>{t('dataset.jobs.errorBody')}</span>
            <Button size="sm" onClick={onRetry}>
              {t('dataset.retry')}
            </Button>
          </div>
        </td>
      </tr>
    )
  if (!list.rows.length)
    return (
      <tr>
        <td colSpan={COLUMNS}>
          <div className="table-empty">
            <Icon name="search" />
            <strong>{t('dataset.jobs.emptyTitle')}</strong>
            <span>{t('dataset.jobs.emptyBody')}</span>
            {filtered && (
              <Button size="sm" onClick={onClear}>
                {t('dataset.jobs.clear')}
              </Button>
            )}
          </div>
        </td>
      </tr>
    )
  const left = list.total - list.rows.length
  return (
    <>
      {list.rows.map((job) => {
        const posted = job.posted_at ? fmt.date(localDate(job.posted_at)) : ''
        return (
          <tr
            key={`${job.source}:${job.external_id}`}
            className="clickable"
            tabIndex={0}
            aria-label={t('dataset.jobs.rowAria', { title: job.title, company: job.company_name ?? '' })}
            onClick={() => onOpen(job)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onOpen(job)
            }}
          >
            <td>
              <div className="t">{job.title}</div>
              <div className="t-sub">{[job.company_name, job.location, posted].filter(Boolean).join(' · ')}</div>
            </td>
            <td className="col-sm-hide">{job.company_name}</td>
            <td className="col-sm-hide">{job.location}</td>
            <td>
              <SourceBadge source={job.source} />
            </td>
            <td className="col-sm-hide">{job.salary}</td>
            <td className="col-sm-hide ds-nowrap">{posted}</td>
          </tr>
        )
      })}
      {left > 0 && (
        <tr>
          <td colSpan={COLUMNS} className="ds-more">
            <Button variant="ghost" size="sm" disabled={loadingMore} aria-busy={loadingMore || undefined} onClick={onMore}>
              {t('dataset.jobs.more', { n: fmt.number(Math.min(left, PAGE_SIZE)) })}
              <Icon name="chevron-down" />
            </Button>
          </td>
        </tr>
      )}
    </>
  )
}
