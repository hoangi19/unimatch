// Demo-only cards: nothing here calls the network or saves. Delete with mock.ts and useMock.ts.
import { useCallback, useState, type ChangeEvent } from 'react'
import { useI18n, type MessageKey } from '../i18n'
import { Button, Input, Toggle } from '../ui/controls'
import { Modal } from '../ui/Dialog'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/toast-context'
import { EMBED_PROVIDERS, MOCK_EMBED, mockEmbedStatus, RUN_STEPS, runStep, type EmbedSettings } from './mock'
import { SourceBadge } from './SourceBadge'
import { useFakeProgress, type useMockCrawl } from './useMock'

const PHASE_TEXT: readonly MessageKey[] = ['dataset.run.fetching', 'dataset.run.parsing', 'dataset.run.embedding']

export function DemoBadge() {
  const { t } = useI18n()
  return (
    <span className="badge b-warning" title={t('dataset.demo.hint')}>
      {t('dataset.demo')}
    </span>
  )
}

/** "18 minutes ago", "5 hours ago", "3 days ago". */
function useAgo() {
  const { fmt } = useI18n()
  return (at: number) => {
    const min = Math.round((Date.now() - at) / 60_000)
    if (min < 60) return fmt.relative(-min, 'minute')
    if (min < 1440) return fmt.relative(-Math.round(min / 60), 'hour')
    return fmt.relative(-Math.round(min / 1440), 'day')
  }
}

function Progress({ pct, label, text }: { pct: number; label: string; text: string }) {
  const { fmt } = useI18n()
  return (
    <>
      <div className="run-top">
        <span className="phase" aria-live="polite">
          <Icon name="loader" className="ic spinner" />
          <span>{text}</span>
        </span>
        <span className="pct">{fmt.percent(pct / 100)}</span>
      </div>
      <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <i style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
    </>
  )
}

type MockCrawl = ReturnType<typeof useMockCrawl>

export function SourcesCard({ crawl }: { crawl: MockCrawl }) {
  const { t } = useI18n()
  const ago = useAgo()
  return (
    <section className="card source-list" aria-label={t('dataset.src.title')}>
      {crawl.sources.map((s) => {
        const pct = crawl.runs[s.id]
        const running = pct !== undefined
        const step = running ? runStep(pct) : -1
        return (
          <div key={s.id} className={s.enabled ? 'source' : 'source is-disabled'}>
            <div className="ds-min">
              <div className="source-name">
                {s.name}
                <SourceBadge source={s.kind} />
                <span className="badge b-outline mono" title={t('dataset.src.cron')}>
                  {s.cron}
                </span>
                {!s.enabled && <span className="badge">{t('dataset.src.paused')}</span>}
              </div>
              <ul className="chips">
                {s.keywords.map((k) => (
                  <li key={k} className="chip">
                    {k}
                  </li>
                ))}
              </ul>
              <div className="source-meta">
                <span>{s.location}</span>
                <span>
                  <Icon name="clock" />
                  {t('dataset.src.lastRun', { ago: ago(s.lastRunAt), n: s.lastFound })}
                </span>
              </div>
            </div>
            <div className="source-actions">
              <Toggle label="" aria-label={t('dataset.src.enable', { name: s.name })} checked={s.enabled} disabled={running} onChange={(on) => crawl.toggle(s.id, on)} />
              <Button
                variant="cta"
                size="sm"
                disabled={running || !s.enabled}
                aria-busy={running || undefined}
                title={s.enabled ? undefined : t('dataset.src.enableToRun')}
                onClick={() => crawl.run(s.id)}
              >
                {t(running ? 'dataset.src.running' : 'dataset.src.run')}
              </Button>
            </div>
            {running && (
              <div className="run" role="group" aria-label={t('dataset.run.aria', { name: s.name })}>
                <Progress pct={pct} label={t('dataset.run.bar')} text={t(step < 0 ? 'dataset.run.queued' : PHASE_TEXT[step])} />
                <ol className="run-steps">
                  {RUN_STEPS.map((key, i) => (
                    <li key={key} className={i < step ? 'done' : i === step ? 'active' : undefined}>
                      {i < step && <Icon name="check" />}
                      {t(key)}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

export function HistoryCard({ crawl }: { crawl: MockCrawl }) {
  const { t, fmt } = useI18n()
  const ago = useAgo()
  const badge = { success: 'b-success', failed: 'b-danger', partial: 'b-warning' } as const
  return (
    <section className="card" aria-labelledby="ds-hist-title">
      <div className="card-head">
        <div>
          <h3 id="ds-hist-title">
            <Icon name="clock" />
            {t('dataset.hist.title')}
          </h3>
          <p>{t('dataset.hist.sub')}</p>
        </div>
        <DemoBadge />
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption className="sr-only">{t('dataset.hist.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('dataset.th.started')}</th>
              <th scope="col">{t('dataset.th.source')}</th>
              <th scope="col">{t('dataset.th.status')}</th>
              <th scope="col" className="num">
                {t('dataset.th.found')}
              </th>
              <th scope="col" className="num col-sm-hide">
                {t('dataset.th.duration')}
              </th>
            </tr>
          </thead>
          <tbody>
            {crawl.history.slice(0, 7).map((h) => (
              <tr key={`${h.source}-${h.at}`}>
                <td className="ds-nowrap">
                  {fmt.shortTime(new Date(h.at).toISOString())}
                  <div className="hint">{ago(h.at)}</div>
                </td>
                <td>{crawl.sources.find((s) => s.id === h.source)?.name ?? h.source}</td>
                <td>
                  <span className={`badge ${badge[h.status]}`}>{t(`dataset.hist.${h.status}`)}</span>
                  {h.error && <div className="err-line">{t(h.error)}</div>}
                </td>
                <td className="num">{t('dataset.hist.line', { a: fmt.number(h.found), b: fmt.number(h.added) })}</td>
                <td className="num col-sm-hide">{fmt.duration(h.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function EmbedCard({ total }: { total: number }) {
  const { t, fmt } = useI18n()
  const toast = useToast()
  const [saved, setSaved] = useState<EmbedSettings>(MOCK_EMBED)
  const [form, setForm] = useState<EmbedSettings>(MOCK_EMBED)
  const [confirm, setConfirm] = useState(false)
  const onDone = useCallback(() => toast({ kind: 'success', title: t('dataset.emb.done') }), [t, toast])
  const { runs, start } = useFakeProgress(onDone)
  const pct = runs.reindex
  const models = EMBED_PROVIDERS[form.provider].models
  const changed = form.provider !== saved.provider || form.model !== saved.model
  const set = (patch: Partial<EmbedSettings>) => setForm((f) => ({ ...f, ...patch }))
  const num = (key: 'chunkSize' | 'overlap' | 'retention') => ({
    type: 'number',
    inputMode: 'numeric' as const,
    value: String(form[key]),
    onChange: (e: ChangeEvent<HTMLInputElement>) => set({ [key]: Number(e.target.value) }),
  })

  const reindex = () => {
    setConfirm(false)
    setSaved(form)
    start('reindex')
  }

  return (
    <section className="card" aria-labelledby="ds-emb-title">
      <div className="card-head">
        <div>
          <h3 id="ds-emb-title">
            <Icon name="sparkles" />
            {t('dataset.emb.title')}
          </h3>
          <p>{t('dataset.emb.sub')}</p>
        </div>
        <DemoBadge />
      </div>
      <div className="card-body">
        <div className="field">
          <label htmlFor="ds-emb-provider">{t('dataset.emb.provider')}</label>
          <select
            id="ds-emb-provider"
            className="input"
            value={form.provider}
            onChange={(e) => set({ provider: e.target.value, model: Object.keys(EMBED_PROVIDERS[e.target.value].models)[0] })}
          >
            {Object.entries(EMBED_PROVIDERS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ds-emb-model">{t('dataset.emb.model')}</label>
          <select id="ds-emb-model" className="input" value={form.model} onChange={(e) => set({ model: e.target.value })}>
            {Object.entries(models).map(([id, dims]) => (
              <option key={id} value={id}>
                {`${id} · ${t('dataset.emb.dims', { n: fmt.number(dims) })}`}
              </option>
            ))}
          </select>
          <p className="hint">{t('dataset.emb.modelHint')}</p>
        </div>
        {changed && (
          <div className="callout callout-warning" role="status">
            <Icon name="alert" />
            <div className="callout-body">{t('dataset.emb.changeWarn', { n: fmt.number(total) })}</div>
          </div>
        )}
        <div className="grid-2">
          <Input label={t('dataset.emb.chunk')} hint={t('dataset.emb.chunkHint')} min={128} max={2048} step={32} {...num('chunkSize')} />
          <Input label={t('dataset.emb.overlap')} hint={t('dataset.emb.overlapHint')} min={0} max={512} step={16} {...num('overlap')} />
        </div>
        <Input label={t('dataset.emb.retention')} hint={t('dataset.emb.retentionHint')} min={1} max={365} {...num('retention')} />
        {pct !== undefined && (
          <div className="run">
            <Progress
              pct={pct}
              label={t('dataset.emb.reindexBar')}
              text={t('dataset.emb.reindexing', { a: fmt.number(Math.round((pct / 100) * total)), b: fmt.number(total) })}
            />
          </div>
        )}
      </div>
      <div className="card-foot ds-foot">
        <span className="hint mono">{`HNSW · cosine · vector(${EMBED_PROVIDERS[saved.provider].models[saved.model]})`}</span>
        <Button size="sm" icon="rotate" disabled={pct !== undefined} onClick={() => setConfirm(true)}>
          {t('dataset.emb.reindex')}
        </Button>
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('dataset.emb.confirmTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('dataset.cancel')}
            </Button>
            <Button variant="primary" onClick={reindex}>
              {t('dataset.emb.reindex')}
            </Button>
          </>
        }
      >
        <p>{t('dataset.emb.confirmBody', { n: fmt.number(total) })}</p>
      </Modal>
    </section>
  )
}

/** Fake per-job embedding status for the detail drawer. */
export function EmbedStatusBlock({ externalId }: { externalId: string }) {
  const { t } = useI18n()
  const status = mockEmbedStatus(externalId)
  const badge = { embedded: 'b-success', pending: 'b-warning', failed: 'b-danger' }[status]
  return (
    <div className="ds-block">
      <div className="ds-row">
        <h3 className="ds-h">{t('dataset.jd.embedding')}</h3>
        <span className={`badge ${badge}`}>{t(`dataset.st.${status}`)}</span>
        <DemoBadge />
      </div>
      {status !== 'embedded' && (
        <div className={`callout ${status === 'failed' ? 'callout-danger' : 'callout-info'}`}>
          <Icon name={status === 'failed' ? 'alert' : 'clock'} />
          <div className="callout-body">{t(`dataset.jd.${status}`)}</div>
        </div>
      )}
    </div>
  )
}
