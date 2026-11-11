import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n, type MessageKey } from '../i18n'
import { Button, Input, Skeleton } from '../ui/controls'
import { Icon, type IconName } from '../ui/Icon'
import { useToast } from '../ui/toast-context'
import type { ChatbotApi, GuardrailResult, TestResult } from './api'
import './chatbot.css'
import { TestChat } from './TestChat'
import {
  changes,
  EDITABLE_URL,
  LANGUAGES,
  MAX_TOKENS_MIN,
  PROMPT_MAX,
  PROVIDER_KINDS,
  RATE_LIMIT,
  savePlan,
  TEMPERATURE,
  toDraft,
  USES_TEMPERATURE,
  validate,
  type Draft,
  type Errors,
  type GuardrailForm,
  type GuardrailRow,
  type Guardrails,
  type ProviderForm,
  type ProviderKind,
  type ProviderRow,
  type Saved,
  type SettingsForm,
} from './settings'

// Suggestions only: the model field accepts any ID the account can use.
const MODEL_EXAMPLES: Record<ProviderKind, string[]> = {
  hermes: ['hermes-4-70b', 'hermes-4-405b'],
  openai: ['gpt-5-mini', 'gpt-5'],
  anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
  custom: [],
}
const HERMES_URLS: [MessageKey, string][] = [
  ['chatbot.url.nous', 'https://inference-api.nousresearch.com/v1'],
  ['chatbot.url.openrouter', 'https://openrouter.ai/api/v1'],
  ['chatbot.url.vllm', 'https://vllm.example.com/v1'],
]
// Only variables the reply engine fills in.
const PROMPT_VARS = ['{{page_name}}']
// Complaints are a model guardrail check (ModelGuardrail below): nothing else detects them.
const HANDOFF_RULES = ['handoff_on_keyword', 'handoff_on_low_confidence'] as const
const MODEL_CHECKS = ['handoff_on_complaint', 'handoff_on_human_request', 'refuse_off_topic'] as const
const MODEL_ERRORS = ['reply', 'handoff'] as const

/** DOM id of the control for a draft path, so validation can focus it. */
const fieldId = (path: string) => `cb-${path.replace(/\./g, '-')}`

type Conn = { status: 'loading' } | { status: 'done'; result: TestResult }

export function Chatbot({ api }: { api: ChatbotApi }) {
  const { t, fmt } = useI18n()
  const toast = useToast()
  const [saved, setSaved] = useState<Saved | null>(null)
  const [base, setBase] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [conn, setConn] = useState<Partial<Record<ProviderKind, Conn>>>({})
  const pendingFocus = useRef(false)

  const apply = (rows: Saved) => {
    setSaved(rows)
    setBase(toDraft(rows))
    setDraft(toDraft(rows))
  }
  const reload = () => {
    setLoadFailed(false)
    api.load().then(apply, () => setLoadFailed(true))
  }

  useEffect(() => {
    let live = true
    api.load().then(
      (rows) => live && apply(rows),
      () => live && setLoadFailed(true),
    )
    return () => {
      live = false
    }
  }, [api])

  const changed = base && draft ? changes(base, draft) : []
  const dirty = changed.length > 0

  useEffect(() => {
    if (!dirty) return
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', onLeave)
    return () => removeEventListener('beforeunload', onLeave)
  }, [dirty])

  // After a failed save, focus the first invalid control that is on screen.
  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    const first = Object.keys(errors).map((path) => document.getElementById(fieldId(path))).find(Boolean)
    first?.scrollIntoView?.({ block: 'center' })
    first?.focus({ preventScroll: true })
  }, [errors])

  if (loadFailed && !draft) {
    return (
      <div className="chatbot">
        <div className="callout callout-danger" role="alert">
          <Icon name="alert" />
          <div className="callout-body">
            <strong>{t('chatbot.loadFailed')}</strong>
          </div>
          <Button size="sm" onClick={reload}>
            {t('chatbot.retry')}
          </Button>
        </div>
      </div>
    )
  }
  if (!saved || !base || !draft) {
    return (
      <div className="chatbot">
        <div className="bot-config" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <section key={i} className="card card-body">
              <Skeleton width="40%" height={16} />
              <Skeleton height={36} />
              <Skeleton height={36} />
            </section>
          ))}
        </div>
      </div>
    )
  }

  const err = (path: string) => (errors[path] ? t(errors[path]) : undefined)
  const setSettings = (patch: Partial<SettingsForm>) => setDraft({ ...draft, settings: { ...draft.settings, ...patch } })
  const setGuardrails = (patch: Partial<Guardrails>) => setSettings({ guardrails: { ...draft.settings.guardrails, ...patch } })
  const setGuardrail = (patch: Partial<GuardrailForm>) => setDraft({ ...draft, guardrail: { ...draft.guardrail, ...patch } })
  const setProvider = (kind: ProviderKind, patch: Partial<ProviderForm>) =>
    setDraft({ ...draft, providers: { ...draft.providers, [kind]: { ...draft.providers[kind], ...patch } } })
  const rows = Object.fromEntries(saved.providers.map((row) => [row.kind, row])) as Record<ProviderKind, ProviderRow>
  const active = draft.settings.active_provider
  const providerName = (kind: ProviderKind) => rows[kind]?.display_name || t(`chatbot.prov.${kind}`)

  const discard = () => {
    setDraft(base)
    setErrors({})
  }

  const save = async () => {
    const found = validate(draft)
    setErrors(found)
    const paths = Object.keys(found)
    if (paths.length) {
      pendingFocus.current = true
      const hidden = paths.map((path) => path.split('.')[0]).find((kind) => kind !== 'settings' && kind !== 'guardrail' && kind !== active)
      toast({
        kind: 'error',
        title: t('chatbot.save.invalid'),
        body: hidden ? t('chatbot.save.otherProvider', { name: providerName(hidden as ProviderKind) }) : undefined,
      })
      return
    }
    setSaving(true)
    try {
      await api.save(savePlan(base, draft))
      apply(await api.load())
      setConn({})
      toast({ kind: 'success', title: t('chatbot.save.done') })
    } catch {
      // Part of the plan may have landed: refresh the baseline but keep the admin's draft.
      await api.load().then((rows) => (setSaved(rows), setBase(toDraft(rows))), () => {})
      toast({ kind: 'error', title: t('chatbot.save.failed') })
    } finally {
      setSaving(false)
    }
  }

  const test = async (kind: ProviderKind) => {
    setConn((c) => ({ ...c, [kind]: { status: 'loading' } }))
    const result = await api.testConnection(kind).catch(
      (): TestResult => ({ ok: false, error: { kind: 'provider', message: 'Network error' } }),
    )
    setConn((c) => ({ ...c, [kind]: { status: 'done', result } }))
  }

  const p = draft.providers[active]
  const s = draft.settings

  return (
    <div className="chatbot">
      <div className="view-head">
        <div>
          <h2>{t('tab.chatbot')}</h2>
          <p className="sub">{t('chatbot.sub')}</p>
        </div>
      </div>
      <div className="bot-layout">
        <div className="bot-config">
          <Card icon="bot" title={t('chatbot.ai.title')} sub={t('chatbot.ai.sub')}>
            <fieldset className="plain">
              <legend className="label">{t('chatbot.ai.pick')}</legend>
              <div className="prov-grid">
                {PROVIDER_KINDS.map((kind) => (
                  <label key={kind} className="prov">
                    <input
                      type="radio"
                      name="cb-provider"
                      value={kind}
                      checked={active === kind}
                      onChange={() => setSettings({ active_provider: kind })}
                    />
                    <span className="prov-txt">
                      <strong>{providerName(kind)}</strong>
                      <span>{t(`chatbot.vendor.${kind}`)}</span>
                    </span>
                    {rows[kind]?.key_hint && (
                      <span className="prov-key" title={t('chatbot.key.label')}>
                        <Icon name="key" />
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="prov-fields" key={active}>
              {active === 'custom' && (
                <Input
                  id={fieldId('custom.display_name')}
                  label={t('chatbot.ai.name')}
                  placeholder={t('chatbot.ai.namePh')}
                  value={p.display_name}
                  onChange={(e) => setProvider(active, { display_name: e.target.value })}
                />
              )}
              {EDITABLE_URL.has(active) ? (
                <div className="field">
                  <Input
                    id={fieldId(`${active}.base_url`)}
                    className="input mono"
                    label={t('chatbot.ai.baseUrl')}
                    placeholder="https://llm.example.com/v1"
                    autoComplete="off"
                    spellCheck={false}
                    value={p.base_url}
                    error={err(`${active}.base_url`)}
                    hint={t('chatbot.ai.baseUrlHint')}
                    onChange={(e) => setProvider(active, { base_url: e.target.value })}
                  />
                  {active === 'hermes' && (
                    <Examples
                      items={HERMES_URLS.map(([label, url]) => ({ label: t(label), value: url }))}
                      current={p.base_url}
                      onPick={(base_url) => setProvider(active, { base_url })}
                    />
                  )}
                </div>
              ) : (
                <div className="field">
                  <span className="label">{t('chatbot.ai.baseUrl')}</span>
                  <div className="input mono readonly-box">{p.base_url}</div>
                </div>
              )}
              <div className="field">
                <Input
                  id={fieldId(`${active}.model`)}
                  className="input mono"
                  label={t('chatbot.ai.model')}
                  placeholder={active === 'custom' ? 'qwen2.5-72b-instruct' : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  value={p.model}
                  error={err(`${active}.model`)}
                  hint={MODEL_EXAMPLES[active].length ? t('chatbot.ai.examplesHint') : undefined}
                  onChange={(e) => setProvider(active, { model: e.target.value })}
                />
                <Examples
                  items={MODEL_EXAMPLES[active].map((m) => ({ label: m, value: m }))}
                  current={p.model}
                  onPick={(model) => setProvider(active, { model })}
                  mono
                />
              </div>
              <KeyField
                key={rows[active]?.key_saved_at ?? 'none'}
                id={fieldId(`${active}.key`)}
                row={rows[active]}
                form={p}
                error={err(`${active}.key`)}
                onChange={(patch) => setProvider(active, patch)}
              />
              {active === 'custom' && (
                <>
                  <Headers form={p} errors={errors} onChange={(headers) => setProvider(active, { headers })} />
                  <label className="check">
                    <input type="checkbox" checked={p.supports_tools} onChange={(e) => setProvider(active, { supports_tools: e.target.checked })} />
                    <span>
                      <span className="check-title">{t('chatbot.ai.tools')}</span>
                      <br />
                      <span className="hint">{t('chatbot.ai.toolsHint')}</span>
                    </span>
                  </label>
                  {!p.supports_tools && (
                    <div className="callout callout-warning" role="status">
                      <Icon name="alert" />
                      <div className="callout-body">{t('chatbot.ai.toolsOff')}</div>
                    </div>
                  )}
                </>
              )}
              <div className="conn-row">
                <Button icon={conn[active]?.status === 'loading' ? undefined : 'sparkles'} disabled={conn[active]?.status === 'loading'} onClick={() => void test(active)}>
                  {conn[active]?.status === 'loading' && <Spinner />}
                  {t('chatbot.conn.test')}
                </Button>
                <span aria-live="polite">
                  <ConnStatus conn={conn[active]} />
                </span>
              </div>
              {dirty && <p className="hint">{t('chatbot.conn.savedOnly')}</p>}
            </div>
          </Card>

          <Card icon="sparkles" title={t('chatbot.gen.title')}>
            <div className="grid-2">
              <div className="field">
                <label htmlFor={fieldId('settings.temperature')}>{t('chatbot.gen.temp')}</label>
                <div className="range-row">
                  <input
                    id={fieldId('settings.temperature')}
                    type="range"
                    min={TEMPERATURE.min}
                    max={TEMPERATURE.max}
                    step={TEMPERATURE.step}
                    value={s.temperature}
                    aria-describedby={fieldId('settings.temperature') + '-note'}
                    onChange={(e) => setSettings({ temperature: Number(e.target.value) })}
                  />
                  <output htmlFor={fieldId('settings.temperature')}>{fmt.number(s.temperature, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</output>
                </div>
                <div className="range-scale" aria-hidden="true">
                  <span>{t('chatbot.gen.precise')}</span>
                  <span>{t('chatbot.gen.creative')}</span>
                </div>
                <p className="hint" id={fieldId('settings.temperature') + '-note'}>
                  {USES_TEMPERATURE.has(active) ? t('chatbot.gen.tempHint') : t('chatbot.gen.tempIgnored', { name: providerName(active) })}
                </p>
              </div>
              <Input
                id={fieldId('settings.max_tokens')}
                type="number"
                inputMode="numeric"
                min={MAX_TOKENS_MIN}
                step={64}
                label={t('chatbot.gen.maxTokens')}
                value={s.max_tokens}
                error={err('settings.max_tokens')}
                hint={t('chatbot.gen.maxTokensHint', { min: MAX_TOKENS_MIN })}
                onChange={(e) => setSettings({ max_tokens: e.target.value })}
              />
            </div>
          </Card>

          <Card icon="bot" title={t('chatbot.prompt.title')} sub={t('chatbot.prompt.sub')}>
            <SystemPrompt value={s.system_prompt} error={err('settings.system_prompt')} onChange={(system_prompt) => setSettings({ system_prompt })} />
            <Area path="settings.greeting" label={t('chatbot.prompt.greeting')} hint={t('chatbot.prompt.greetingHint')} value={s.greeting} error={err('settings.greeting')} onChange={(greeting) => setSettings({ greeting })} />
            <Area path="settings.fallback" label={t('chatbot.prompt.fallback')} hint={t('chatbot.prompt.fallbackHint')} value={s.fallback} error={err('settings.fallback')} onChange={(fallback) => setSettings({ fallback })} />
            <fieldset className="plain field">
              <legend className="label">{t('chatbot.prompt.lang')}</legend>
              <div className="segmented">
                {LANGUAGES.map((lang) => (
                  <label key={lang}>
                    <input type="radio" name="cb-language" value={lang} checked={s.language === lang} onChange={() => setSettings({ language: lang })} />
                    <span>{t(`chatbot.lang.${lang}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>

          <Card icon="shield" title={t('chatbot.guard.title')} sub={t('chatbot.guard.sub')}>
            <Topics topics={s.guardrails.refused_topics} onChange={(refused_topics) => setGuardrails({ refused_topics })} />
            <Input
              id={fieldId('settings.rate_limit_per_hour')}
              type="number"
              inputMode="numeric"
              min={RATE_LIMIT.min}
              max={RATE_LIMIT.max}
              label={t('chatbot.guard.rate')}
              value={s.rate_limit_per_hour}
              error={err('settings.rate_limit_per_hour')}
              hint={t('chatbot.guard.rateHint')}
              onChange={(e) => setSettings({ rate_limit_per_hour: e.target.value })}
            />
            <fieldset className="plain field">
              <legend className="label">{t('chatbot.guard.handoff')}</legend>
              {HANDOFF_RULES.map((rule) => (
                <label key={rule} className="check">
                  <input type="checkbox" checked={s.guardrails[rule]} onChange={(e) => setGuardrails({ [rule]: e.target.checked })} />
                  <span>
                    <span className="check-title">{t(`chatbot.guard.${rule}`)}</span>
                    <br />
                    <span className="hint">{t(`chatbot.guard.${rule}.hint`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Area path="settings.handoff_message" label={t('chatbot.guard.handoffMsg')} value={s.handoff_message} error={err('settings.handoff_message')} onChange={(handoff_message) => setSettings({ handoff_message })} />
          </Card>

          <ModelGuardrail
            api={api}
            row={saved.guardrail}
            form={draft.guardrail}
            guardrails={s.guardrails}
            errors={errors}
            dirty={dirty}
            onForm={setGuardrail}
            onGuardrails={setGuardrails}
          />
        </div>
        <TestChat api={api} draft={draft} dirty={dirty} />
      </div>

      <div className={dirty ? 'savebar show' : 'savebar'} role="region" aria-label={t('chatbot.save.region')} hidden={!dirty}>
        <span className="msg-txt">
          <Icon name="alert" />
          {t('chatbot.save.unsaved', { n: changed.length })}
        </span>
        <Button variant="ghost" disabled={saving} onClick={discard}>
          {t('chatbot.save.discard')}
        </Button>
        <Button variant="cta" disabled={saving} aria-busy={saving || undefined} onClick={() => void save()}>
          {saving && <Spinner />}
          {t('chatbot.save.save')}
        </Button>
      </div>
    </div>
  )
}

function Card({ icon, title, sub, children }: { icon: IconName; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>
            <Icon name={icon} />
            {title}
          </h3>
          {sub && <p>{sub}</p>}
        </div>
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}

function Examples({ items, current, onPick, mono }: { items: { label: string; value: string }[]; current: string; onPick: (v: string) => void; mono?: boolean }) {
  const { t } = useI18n()
  if (!items.length) return null
  return (
    <div className="examples">
      <span className="hint">{t('chatbot.ai.examples')}:</span>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={mono ? 'chip chip-toggle mono' : 'chip chip-toggle'}
          title={item.value}
          aria-pressed={current.trim() === item.value}
          onClick={() => onPick(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

type KeyForm = Pick<ProviderForm, 'key' | 'removeKey'>
type KeyFieldProps = {
  id: string
  row: Pick<ProviderRow, 'key_hint' | 'key_saved_at'>
  form: KeyForm
  error?: string
  onChange: (patch: Partial<KeyForm>) => void
}

/** Write-only: the saved key is shown only as its hint; a new key lives in the draft until Save sends it. */
function KeyField({ id, row, form, error, onChange }: KeyFieldProps) {
  const { t, fmt } = useI18n()
  const [shown, setShown] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const hint = row.key_hint
  const editing = !hint || replacing || form.key !== ''
  const noteId = `${id}-note`
  const date = row.key_saved_at ? fmt.date(row.key_saved_at) : ''

  let body: ReactNode
  if (hint && form.removeKey) {
    body = (
      <div className="key-saved is-removed">
        <span className="mono">{hint}</span>
        <span className="hint">{t('chatbot.key.removing')}</span>
        <span className="spacer" />
        <Button size="sm" onClick={() => onChange({ removeKey: false })}>
          {t('chatbot.key.keep')}
        </Button>
      </div>
    )
  } else if (!editing) {
    body = (
      <div className="key-saved">
        <Icon name="key" />
        <span className="mono" data-testid="key-hint">
          {hint}
        </span>
        <span className="hint">{t('chatbot.key.saved', { date })}</span>
        <span className="spacer" />
        <Button size="sm" onClick={() => setReplacing(true)}>
          {t('chatbot.key.replace')}
        </Button>
        <Button size="sm" variant="ghost" className="ghost-danger" onClick={() => onChange({ removeKey: true })}>
          {t('chatbot.key.remove')}
        </Button>
      </div>
    )
  } else {
    body = (
      <>
        <div className="input-group">
          <input
            id={id}
            className="input mono"
            type={shown ? 'text' : 'password'}
            value={form.key}
            placeholder={t('chatbot.key.ph')}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={noteId}
            autoFocus={replacing}
            onChange={(e) => onChange({ key: e.target.value })}
          />
          <Button icon={shown ? 'eye-off' : 'eye'} label={t(shown ? 'chatbot.key.hide' : 'chatbot.key.show')} aria-pressed={shown} onClick={() => setShown(!shown)} />
        </div>
        {hint && (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => (setReplacing(false), onChange({ key: '' }))}>
            {t('chatbot.key.cancelReplace')}
          </Button>
        )}
      </>
    )
  }

  return (
    <div className="field">
      {editing && !(hint && form.removeKey) ? <label htmlFor={id}>{t('chatbot.key.label')}</label> : <span className="label">{t('chatbot.key.label')}</span>}
      {body}
      {error ? (
        <p id={noteId} className="err">
          <Icon name="alert" />
          {error}
        </p>
      ) : (
        <p id={noteId} className="hint">
          {t('chatbot.key.hint')}
        </p>
      )}
    </div>
  )
}

type ModelGuardrailProps = {
  api: ChatbotApi
  row: GuardrailRow
  form: GuardrailForm
  guardrails: Guardrails
  errors: Errors
  dirty: boolean
  onForm: (patch: Partial<GuardrailForm>) => void
  onGuardrails: (patch: Partial<Guardrails>) => void
}

type Decided = { status: 'loading' } | { status: 'done'; result: GuardrailResult }

/** Quyet on FPT AI Marketplace: one decision per turn before the reply model. Tests use the saved config. */
function ModelGuardrail({ api, row, form, guardrails: g, errors, dirty, onForm, onGuardrails }: ModelGuardrailProps) {
  const { t, fmt } = useI18n()
  const [conn, setConn] = useState<Decided>()
  const [sample, setSample] = useState('')
  const [tried, setTried] = useState<Decided>()
  const err = (path: string) => (errors[path] ? t(errors[path]) : undefined)
  const run = async (text: string | undefined, set: (d: Decided) => void) => {
    set({ status: 'loading' })
    const result = await api.testGuardrail(text).catch(
      (): GuardrailResult => ({ ok: false, error: { kind: 'provider', message: 'Network error' } }),
    )
    set({ status: 'done', result })
  }

  return (
    <Card icon="shield" title={t('guardrail.title')} sub={t('guardrail.sub')}>
      <label className="check">
        <input type="checkbox" checked={g.model_enabled} onChange={(e) => onGuardrails({ model_enabled: e.target.checked })} />
        <span>
          <span className="check-title">{t('guardrail.enable')}</span>
          <br />
          <span className="hint">{t('guardrail.enableHint')}</span>
        </span>
      </label>
      <div className="field">
        <span className="label">{t('guardrail.provider')}</span>
        <div className="input readonly-box">{t('guardrail.providerName')}</div>
      </div>
      <div className="grid-2">
        <Input
          id={fieldId('guardrail.base_url')}
          className="input mono"
          label={t('chatbot.ai.baseUrl')}
          autoComplete="off"
          spellCheck={false}
          value={form.base_url}
          error={err('guardrail.base_url')}
          onChange={(e) => onForm({ base_url: e.target.value })}
        />
        <Input
          id={fieldId('guardrail.model')}
          className="input mono"
          label={t('chatbot.ai.model')}
          autoComplete="off"
          spellCheck={false}
          value={form.model}
          error={err('guardrail.model')}
          onChange={(e) => onForm({ model: e.target.value })}
        />
      </div>
      <KeyField key={row.key_saved_at ?? 'none'} id={fieldId('guardrail.key')} row={row} form={form} error={err('guardrail.key')} onChange={onForm} />
      <fieldset className="plain field">
        <legend className="label">{t('guardrail.checks')}</legend>
        {MODEL_CHECKS.map((check) => (
          <label key={check} className="check">
            <input type="checkbox" checked={g[check]} onChange={(e) => onGuardrails({ [check]: e.target.checked })} />
            <span>
              <span className="check-title">{t(`guardrail.${check}`)}</span>
              <br />
              <span className="hint">{t(`guardrail.${check}.hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {g.refuse_off_topic && (
        <Area
          path="settings.guardrails.off_topic_message"
          label={t('guardrail.offTopicMsg')}
          value={g.off_topic_message}
          error={err('settings.guardrails.off_topic_message')}
          onChange={(off_topic_message) => onGuardrails({ off_topic_message })}
        />
      )}
      <fieldset className="plain field">
        <legend className="label">{t('guardrail.onError')}</legend>
        <div className="segmented">
          {MODEL_ERRORS.map((mode) => (
            <label key={mode}>
              <input type="radio" name="cb-model-error" value={mode} checked={g.on_model_error === mode} onChange={() => onGuardrails({ on_model_error: mode })} />
              <span>{t(`guardrail.onError.${mode}`)}</span>
            </label>
          ))}
        </div>
        <p className="hint">{t('guardrail.onErrorHint')}</p>
      </fieldset>
      <div className="conn-row">
        <Button icon={conn?.status === 'loading' ? undefined : 'sparkles'} disabled={conn?.status === 'loading'} onClick={() => void run(undefined, setConn)}>
          {conn?.status === 'loading' && <Spinner />}
          {t('chatbot.conn.test')}
        </Button>
        <span aria-live="polite">
          <ConnStatus conn={conn} />
        </span>
      </div>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          if (sample.trim()) void run(sample.trim(), setTried)
        }}
      >
        <label htmlFor="cb-guardrail-try">{t('guardrail.try')}</label>
        <div className="input-group">
          <input id="cb-guardrail-try" className="input" value={sample} maxLength={2000} placeholder={t('guardrail.tryPh')} onChange={(e) => setSample(e.target.value)} />
          <Button type="submit" disabled={!sample.trim() || tried?.status === 'loading'}>
            {tried?.status === 'loading' && <Spinner />}
            {t('guardrail.tryRun')}
          </Button>
        </div>
        <p className="hint" aria-live="polite">
          {tried?.status === 'done' && tried.result.ok
            ? t('guardrail.decision', { decision: t(`guardrail.decision.${tried.result.decision}`), ms: fmt.number(tried.result.latencyMs) })
            : tried?.status === 'done' && !tried.result.ok
              ? t(`chatbot.conn.err.${tried.result.error.kind}`)
              : t('guardrail.noConfidence')}
        </p>
      </form>
      {dirty && <p className="hint">{t('chatbot.conn.savedOnly')}</p>}
    </Card>
  )
}

function Headers({ form, errors, onChange }: { form: ProviderForm; errors: Errors; onChange: (headers: ProviderForm['headers']) => void }) {
  const { t } = useI18n()
  const set = (i: number, patch: Partial<ProviderForm['headers'][number]>) => onChange(form.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)))
  return (
    <fieldset className="plain field">
      <legend className="label">
        {t('chatbot.ai.headers')} <span className="opt">{t('chatbot.optional')}</span>
      </legend>
      <p className="hint">{t('chatbot.ai.headersHint')}</p>
      <div className="hdr-rows">
        {form.headers.map((h, i) => {
          const id = fieldId(`custom.headers.${i}`)
          const error = errors[`custom.headers.${i}`]
          return (
            <div key={i} className="hdr-row">
              <div>
                <input
                  id={id}
                  className="input mono"
                  value={h.name}
                  placeholder="X-Api-Version"
                  aria-label={t('chatbot.ai.headerName', { n: i + 1 })}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-note` : undefined}
                  onChange={(e) => set(i, { name: e.target.value })}
                />
                {error && (
                  <p id={`${id}-note`} className="err">
                    <Icon name="alert" />
                    {t(error)}
                  </p>
                )}
              </div>
              <input className="input mono" value={h.value} placeholder="2024-10-01" aria-label={t('chatbot.ai.headerValue', { n: i + 1 })} onChange={(e) => set(i, { value: e.target.value })} />
              <Button variant="ghost" icon="trash" label={t('chatbot.ai.removeHeader', { n: i + 1 })} onClick={() => onChange(form.headers.filter((_, j) => j !== i))} />
            </div>
          )
        })}
      </div>
      <Button size="sm" icon="plus" className="self-start" onClick={() => onChange([...form.headers, { name: '', value: '' }])}>
        {t('chatbot.ai.addHeader')}
      </Button>
    </fieldset>
  )
}

function ConnStatus({ conn }: { conn?: Conn | Decided }) {
  const { t, fmt } = useI18n()
  if (!conn) return null
  if (conn.status === 'loading') return <span className="conn conn-loading">{t('chatbot.conn.testing')}</span>
  const { result } = conn
  if (result.ok) {
    return (
      <span className="conn conn-ok">
        <Icon name="check" />
        {t('chatbot.conn.ok', { ms: fmt.number(result.latencyMs), model: result.model })}
      </span>
    )
  }
  return (
    <span className="conn conn-fail">
      <Icon name="alert" />
      {t(`chatbot.conn.err.${result.error.kind}`)}
    </span>
  )
}

type AreaProps = { path: string; label: string; hint?: string; value: string; error?: string; rows?: number; mono?: boolean; onChange: (v: string) => void; footer?: ReactNode }

function Area({ path, label, hint, value, error, rows = 2, mono, onChange, footer }: AreaProps) {
  const id = fieldId(path)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className={mono ? 'input textarea mono' : 'input textarea'}
        rows={rows}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {footer}
      {error ? (
        <p id={`${id}-note`} className="err">
          <Icon name="alert" />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-note`} className="hint">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

function SystemPrompt({ value, error, onChange }: { value: string; error?: string; onChange: (v: string) => void }) {
  const { t, fmt } = useI18n()
  const insert = (v: string) => {
    const el = document.getElementById(fieldId('settings.system_prompt')) as HTMLTextAreaElement | null
    const at = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? at
    onChange(value.slice(0, at) + v + value.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + v.length, at + v.length)
    })
  }
  return (
    <Area
      path="settings.system_prompt"
      label={t('chatbot.prompt.system')}
      value={value}
      error={error}
      rows={12}
      mono
      onChange={onChange}
      footer={
        <div className="prompt-meta">
          <div className="vars" role="group" aria-label={t('chatbot.prompt.vars')}>
            {PROMPT_VARS.map((v) => (
              <button key={v} type="button" onClick={() => insert(v)}>
                {v}
              </button>
            ))}
          </div>
          <span className={value.length > PROMPT_MAX ? 'over' : undefined} aria-live="polite">
            {t('chatbot.prompt.count', { n: fmt.number(value.length), max: fmt.number(PROMPT_MAX) })}
          </span>
        </div>
      }
    />
  )
}

function Topics({ topics, onChange }: { topics: string[]; onChange: (topics: string[]) => void }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [dup, setDup] = useState('')
  const add = () => {
    const v = text.trim().replace(/,$/, '').trim()
    if (!v) return
    if (topics.some((x) => x.toLowerCase() === v.toLowerCase())) return setDup(v)
    onChange([...topics, v])
    setText('')
  }
  return (
    <div className="field">
      <label htmlFor="cb-topic">{t('chatbot.guard.topics')}</label>
      <div className="tag-input">
        {topics.map((topic, i) => (
          <span key={topic} className="chip">
            {topic}
            <button type="button" className="chip-x" aria-label={t('chatbot.guard.removeTopic', { topic })} onClick={() => onChange(topics.filter((_, j) => j !== i))}>
              <Icon name="x" />
            </button>
          </span>
        ))}
        <input
          id="cb-topic"
          value={text}
          placeholder={t('chatbot.guard.topicPh')}
          autoComplete="off"
          aria-invalid={dup ? true : undefined}
          aria-describedby="cb-topic-note"
          onChange={(e) => (setText(e.target.value), setDup(''))}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !text && topics.length) return onChange(topics.slice(0, -1))
            if (e.key !== 'Enter' && e.key !== ',') return
            e.preventDefault()
            // Vietnamese IMEs compose with Enter; adding mid-composition would cut the word.
            if (!e.nativeEvent.isComposing) add()
          }}
        />
      </div>
      {dup ? (
        <p id="cb-topic-note" className="err">
          <Icon name="alert" />
          {t('chatbot.guard.topicDup', { topic: dup })}
        </p>
      ) : (
        <p id="cb-topic-note" className="hint">
          {t('chatbot.guard.topicHint')}
        </p>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
