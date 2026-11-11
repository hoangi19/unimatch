import { useEffect, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { Button, Skeleton } from '../ui/controls'
import { Drawer } from '../ui/Dialog'
import { Icon } from '../ui/Icon'
import { localDate, safeUrl, type DatasetData, type JobDetail, type JobListRow } from './data'
import { EmbedStatusBlock } from './MockCards'
import { SourceBadge } from './SourceBadge'

/** Read-only job detail. The only place contact and poster data are shown. */
export function JobDrawer({ data, job, onClose }: { data: DatasetData; job: JobListRow | null; onClose: () => void }) {
  const { t } = useI18n()
  const [loaded, setLoaded] = useState<{ id: string; detail: JobDetail | 'error' } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const id = job && `${job.source}:${job.external_id}#${attempt}`
  const detail = loaded && loaded.id === id ? loaded.detail : null

  useEffect(() => {
    if (!job || !id) return
    let live = true
    data.loadJob(job.source, job.external_id).then(
      (d) => live && setLoaded({ id, detail: d }),
      () => live && setLoaded({ id, detail: 'error' }),
    )
    return () => {
      live = false
    }
  }, [data, job, id])

  return (
    <Drawer open={!!job} onClose={onClose} title={job?.title ?? ''}>
      {detail === 'error' ? (
        <div className="callout callout-danger" role="alert">
          <Icon name="alert" />
          <div className="callout-body">
            {t('dataset.jd.error')}{' '}
            <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
              {t('dataset.retry')}
            </Button>
          </div>
        </div>
      ) : detail ? (
        <Detail job={detail} />
      ) : (
        <div className="ds-block" aria-busy="true">
          <Skeleton width="60%" />
          <Skeleton width="90%" />
          <Skeleton width="80%" />
        </div>
      )}
    </Drawer>
  )
}

function Detail({ job }: { job: JobDetail }) {
  const { t, fmt } = useI18n()
  const link = safeUrl(job.link)
  const apply = safeUrl(job.apply_url)
  const poster = safeUrl(job.poster_url)
  const facts: [string, ReactNode][] = [
    [t('dataset.jd.company'), job.company_name],
    [t('dataset.jd.location'), job.location],
    [t('dataset.jd.salary'), job.salary],
    [t('dataset.jd.posted'), job.posted_at && fmt.date(localDate(job.posted_at))],
    [t('dataset.jd.applicants'), job.applicants_count !== null && fmt.number(job.applicants_count)],
    [t('dataset.jd.sourceName'), job.source_name],
    [t('dataset.jd.scraped'), job.scraped_at && fmt.date(job.scraped_at, { dateStyle: 'medium', timeStyle: 'short' })],
  ]
  const hasContact = job.contact || job.poster_name || poster

  return (
    <div className="ds-detail">
      <ul className="chips">
        <li>
          <SourceBadge source={job.source} />
        </li>
        {[job.employment_type, job.seniority_level, job.industries].filter(Boolean).map((v) => (
          <li key={v} className="badge b-outline">
            {v}
          </li>
        ))}
      </ul>
      <dl className="grid-2 ds-facts">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="kv">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {(link || apply) && (
        <div className="ds-row">
          {link && (
            <a className="btn btn-secondary btn-sm" href={link} target="_blank" rel="noopener noreferrer">
              {t('dataset.jd.view')}
              <Icon name="external" />
            </a>
          )}
          {apply && apply !== link && (
            <a className="btn btn-primary btn-sm" href={apply} target="_blank" rel="noopener noreferrer">
              {t('dataset.jd.apply')}
              <Icon name="external" />
            </a>
          )}
        </div>
      )}
      <hr className="divider" />
      <div className="ds-block">
        <h3 className="ds-h">{t('dataset.jd.desc')}</h3>
        {job.description_text ? <p className="job-desc">{job.description_text}</p> : <p className="hint">{t('dataset.jd.noDesc')}</p>}
      </div>
      {job.benefits.length > 0 && (
        <div className="ds-block">
          <h3 className="ds-h">{t('dataset.jd.benefits')}</h3>
          <ul className="chips">
            {job.benefits.map((b, i) => (
              <li key={i} className="chip">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasContact && (
        <div className="ds-block">
          <h3 className="ds-h">{t('dataset.jd.contact')}</h3>
          {job.contact && <p className="job-desc">{job.contact}</p>}
          {(job.poster_name || poster) && (
            <p className="ds-row">
              <Icon name="user" />
              {job.poster_name ?? t('dataset.jd.poster')}
              {job.poster_title && <span className="muted">{job.poster_title}</span>}
              {poster && (
                <a href={poster} target="_blank" rel="noopener noreferrer">
                  {t('dataset.jd.profile')}
                  <Icon name="external" />
                </a>
              )}
            </p>
          )}
        </div>
      )}
      <hr className="divider" />
      <EmbedStatusBlock externalId={job.external_id} />
    </div>
  )
}
