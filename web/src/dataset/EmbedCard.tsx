// Embedding settings: the real connection of the job embedding model (base URL, model, key, test),
// plus the demo chunking controls. Vectors are only comparable within one model, so this is separate
// from the chat provider and the guardrail model.
import { useEffect, useState } from 'react'
import { KeyField } from '../chatbot/Chatbot'
import '../chatbot/chatbot.css'
import { useI18n } from '../i18n'
import { Button, Input, Skeleton } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/toast-context'
import { embeddingChange, embeddingErrors, type DatasetData, type EmbeddingForm, type EmbeddingRow, type EmbedTestResult } from './data'
import { ChunkingDemo } from './MockCards'

const formOf = (row: EmbeddingRow): EmbeddingForm => ({ base_url: row.base_url, model: row.model, key: '', removeKey: false })

export function EmbedCard({ data, total }: { data: DatasetData; total: number }) {
  const { t, fmt } = useI18n()
  const toast = useToast()
  const [row, setRow] = useState<EmbeddingRow | null | 'error'>(null)
  const [form, setForm] = useState<EmbeddingForm | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<'loading' | EmbedTestResult | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    data.loadEmbedding().then(
      (r) => (setRow(r), setForm(formOf(r))),
      () => setRow('error'),
    )
  }, [data, attempt])

  const head = (
    <div className="card-head">
      <div>
        <h3 id="ds-emb-title">
          <Icon name="sparkles" />
          {t('dataset.emb.title')}
        </h3>
        <p>{t('dataset.emb.sub')}</p>
      </div>
    </div>
  )

  if (row === 'error' || row === null || !form) {
    return (
      <section className="card ds-emb" aria-labelledby="ds-emb-title">
        {head}
        <div className="card-body">
          {row === 'error' ? (
            <div className="callout callout-danger" role="alert">
              <Icon name="alert" />
              <div className="callout-body">{t('dataset.emb.loadError')}</div>
              <Button size="sm" onClick={() => (setRow(null), setAttempt((n) => n + 1))}>
                {t('dataset.retry')}
              </Button>
            </div>
          ) : (
            <Skeleton height={160} />
          )}
        </div>
      </section>
    )
  }

  const change = embeddingChange(row, form)
  const dirty = Object.keys(change).length > 0
  const errors = embeddingErrors(form)
  const err = (field: keyof typeof errors) => (showErrors && errors[field] ? t(errors[field]) : undefined)
  const set = (patch: Partial<EmbeddingForm>) => setForm({ ...form, ...patch })

  const save = async () => {
    if (Object.keys(errors).length) return setShowErrors(true)
    setSaving(true)
    try {
      await data.saveEmbedding(change)
      const fresh = await data.loadEmbedding()
      setRow(fresh)
      setForm(formOf(fresh))
      setShowErrors(false)
      setTest(null)
      toast({ kind: 'success', title: t('dataset.emb.saved') })
    } catch (e) {
      toast({ kind: 'error', title: t('dataset.emb.saveError', { message: e instanceof Error ? e.message : '' }) })
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    setTest('loading')
    setTest(await data.testEmbedding().catch((): EmbedTestResult => ({ ok: false, error: { kind: 'provider', message: 'Network error' } })))
  }

  return (
    <section className="card ds-emb" aria-labelledby="ds-emb-title">
      {head}
      <div className="card-body">
        <div className="field">
          <span className="label">{t('dataset.emb.provider')}</span>
          <div className="input readonly-box">{row.provider}</div>
        </div>
        <Input
          className="input mono"
          label={t('dataset.emb.baseUrl')}
          value={form.base_url}
          error={err('base_url')}
          spellCheck={false}
          onChange={(e) => set({ base_url: e.target.value })}
        />
        <Input
          className="input mono"
          label={t('dataset.emb.model')}
          hint={t('dataset.emb.modelHint')}
          value={form.model}
          error={err('model')}
          spellCheck={false}
          onChange={(e) => set({ model: e.target.value })}
        />
        {change.model !== undefined && (
          <div className="callout callout-warning" role="status">
            <Icon name="alert" />
            <div className="callout-body">{t('dataset.emb.changeWarn', { n: fmt.number(total) })}</div>
          </div>
        )}
        <div className="field">
          <span className="label">{t('dataset.emb.dimsLabel')}</span>
          <div className="input mono readonly-box">{t('dataset.emb.dims', { n: fmt.number(row.dims) })}</div>
          <p className="hint">{t('dataset.emb.dimsHint')}</p>
        </div>
        <KeyField id="ds-emb-key" row={row} form={form} error={err('key')} onChange={set} />
        <div className="conn-row">
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={save}>
            {t('dataset.emb.save')}
          </Button>
          <Button size="sm" icon="sparkles" disabled={test === 'loading'} onClick={runTest}>
            {t('chatbot.conn.test')}
          </Button>
          <TestStatus test={test} />
        </div>
        {dirty && <p className="hint">{t('chatbot.conn.savedOnly')}</p>}
        <ChunkingDemo total={total} />
      </div>
      <div className="card-foot ds-foot">
        <span className="hint mono">{`HNSW · cosine · vector(${row.dims})`}</span>
      </div>
    </section>
  )
}

function TestStatus({ test }: { test: 'loading' | EmbedTestResult | null }) {
  const { t, fmt } = useI18n()
  if (!test) return null
  if (test === 'loading') return <span className="conn conn-loading">{t('chatbot.conn.testing')}</span>
  if (test.ok) {
    return (
      <span className="conn conn-ok" role="status">
        <Icon name="check" />
        {t('dataset.emb.testOk', { dims: fmt.number(test.dims), ms: fmt.number(test.latencyMs) })}
      </span>
    )
  }
  // A wrong vector size is bad_config too; its message says which size came back.
  const wrongDims = test.error.kind === 'bad_config' && /dims/.test(test.error.message)
  return (
    <span className="conn conn-fail" role="status">
      <Icon name="alert" />
      {wrongDims ? test.error.message : t(`chatbot.conn.err.${test.error.kind}`)}
    </span>
  )
}
