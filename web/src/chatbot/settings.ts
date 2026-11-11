// Chatbot tab form model: rows from `bot_settings` and `ai_providers` become one editable draft.
// Rules mirror the table checks in supabase/migrations/*_chatbot_settings.sql, so bad input never reaches the DB.
import type { MessageKey } from '../i18n'
import type { Database, Json, Tables } from '../lib/database.types'

export type ProviderKind = Database['public']['Enums']['ai_provider_kind']
export const PROVIDER_KINDS: readonly ProviderKind[] = ['hermes', 'openai', 'anthropic', 'custom']
export type Language = 'vi' | 'en' | 'auto'
export const LANGUAGES: readonly Language[] = ['vi', 'en', 'auto']

export type ProviderRow = Tables<'ai_providers'>
export type SettingsRow = Tables<'bot_settings'>
export type GuardrailRow = Tables<'guardrail_model'>
export type Saved = { settings: SettingsRow; providers: ProviderRow[]; guardrail: GuardrailRow }

export const PROMPT_MAX = 6000
export const TEMPERATURE = { min: 0, max: 1.5, step: 0.1 }
export const MAX_TOKENS_MIN = 64
export const RATE_LIMIT = { min: 1, max: 500 }
// Matches the Messenger text limit the off-topic message is sent with.
export const OFF_TOPIC_MAX = 2000
// Claude and OpenAI's GPT-5 models reject `temperature`, so the engine only sends it to these.
export const USES_TEMPERATURE: ReadonlySet<ProviderKind> = new Set(['hermes', 'custom'])
// Hermes and custom endpoints are set by the admin; OpenAI and Claude use their fixed vendor URL.
export const EDITABLE_URL: ReadonlySet<ProviderKind> = new Set(['hermes', 'custom'])

export type Header = { name: string; value: string }
export type ProviderForm = {
  display_name: string
  base_url: string
  model: string
  headers: Header[]
  supports_tools: boolean
  /** Write-only: sent once through set_provider_key, never read back. */
  key: string
  removeKey: boolean
}
export type ModelError = 'reply' | 'handoff'
export type Guardrails = {
  refused_topics: string[]
  handoff_on_keyword: boolean
  handoff_on_low_confidence: boolean
  handoff_on_complaint: boolean
  // Model guardrail (Quyet): read by the reply engine in supabase/functions/_shared/bot/engine.ts.
  model_enabled: boolean
  handoff_on_human_request: boolean
  refuse_off_topic: boolean
  on_model_error: ModelError
  off_topic_message: string
}
/** The guardrail model's connection; the key is write-only like a provider key. */
export type GuardrailForm = { base_url: string; model: string; key: string; removeKey: boolean }
export type SettingsForm = {
  active_provider: ProviderKind
  temperature: number
  max_tokens: string
  system_prompt: string
  greeting: string
  fallback: string
  handoff_message: string
  language: Language
  rate_limit_per_hour: string
  guardrails: Guardrails
}
export type Draft = { settings: SettingsForm; providers: Record<ProviderKind, ProviderForm>; guardrail: GuardrailForm }

const obj = (value: Json): Record<string, Json | undefined> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}

function guardrailsOf(value: Json): Guardrails {
  const g = obj(value)
  const topics = Array.isArray(g.refused_topics) ? g.refused_topics.filter((t): t is string => typeof t === 'string') : []
  return {
    refused_topics: topics,
    handoff_on_keyword: g.handoff_on_keyword === true,
    handoff_on_low_confidence: g.handoff_on_low_confidence === true,
    handoff_on_complaint: g.handoff_on_complaint === true,
    model_enabled: g.model_enabled === true,
    handoff_on_human_request: g.handoff_on_human_request === true,
    refuse_off_topic: g.refuse_off_topic === true,
    on_model_error: g.on_model_error === 'handoff' ? 'handoff' : 'reply',
    off_topic_message: typeof g.off_topic_message === 'string' ? g.off_topic_message : '',
  }
}

export function toDraft({ settings, providers, guardrail }: Saved): Draft {
  const forms = {} as Record<ProviderKind, ProviderForm>
  for (const row of providers) {
    forms[row.kind] = {
      display_name: row.display_name ?? '',
      base_url: row.base_url ?? '',
      model: row.model ?? '',
      headers: Object.entries(obj(row.extra_headers)).map(([name, value]) => ({ name, value: String(value) })),
      supports_tools: row.supports_tools,
      key: '',
      removeKey: false,
    }
  }
  return {
    settings: {
      active_provider: settings.active_provider,
      temperature: Number(settings.temperature),
      max_tokens: String(settings.max_tokens),
      system_prompt: settings.system_prompt,
      greeting: settings.greeting,
      fallback: settings.fallback,
      handoff_message: settings.handoff_message,
      language: LANGUAGES.includes(settings.language as Language) ? (settings.language as Language) : 'auto',
      rate_limit_per_hour: String(settings.rate_limit_per_hour),
      guardrails: guardrailsOf(settings.guardrails),
    },
    providers: forms,
    guardrail: { base_url: guardrail.base_url, model: guardrail.model, key: '', removeKey: false },
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Paths that differ from the saved draft, e.g. `settings.greeting`, `hermes.model`, `openai.key`. */
export function changes(saved: Draft, draft: Draft): string[] {
  const paths: string[] = []
  for (const field of Object.keys(draft.settings) as (keyof SettingsForm)[]) {
    if (!same(saved.settings[field], draft.settings[field])) paths.push(`settings.${field}`)
  }
  for (const kind of PROVIDER_KINDS) {
    const a = saved.providers[kind]
    const b = draft.providers[kind]
    if (!a || !b) continue
    for (const field of Object.keys(b) as (keyof ProviderForm)[]) {
      if (field === 'key' ? b.key.trim() !== '' : !same(a[field], b[field])) paths.push(`${kind}.${field}`)
    }
  }
  for (const field of Object.keys(draft.guardrail) as (keyof GuardrailForm)[]) {
    const b = draft.guardrail
    if (field === 'key' ? b.key.trim() !== '' : !same(saved.guardrail[field], b[field])) paths.push(`guardrail.${field}`)
  }
  return paths
}

const URL_RE = /^https:\/\/[^/?#@\s]+/
const HEADER_RE = /^[A-Za-z0-9-]+$/
const isInt = (s: string) => /^\d+$/.test(s.trim())
const badKey = (key: string) => key.length < 8 || key.length > 512 || /\s/.test(key)

export type Errors = Record<string, MessageKey>

/** Field path -> message key. Empty when the draft can be saved. Key order is form order. */
export function validate(draft: Draft): Errors {
  const errors: Errors = {}
  const s = draft.settings
  for (const kind of PROVIDER_KINDS) {
    const p = draft.providers[kind]
    if (!p) continue
    const active = kind === s.active_provider
    if (p.base_url.trim() && !URL_RE.test(p.base_url.trim())) errors[`${kind}.base_url`] = 'chatbot.err.url'
    else if (active && EDITABLE_URL.has(kind) && !p.base_url.trim()) errors[`${kind}.base_url`] = 'chatbot.err.required'
    if (active && !p.model.trim()) errors[`${kind}.model`] = 'chatbot.err.required'
    p.headers.forEach((h, i) => {
      if (!HEADER_RE.test(h.name.trim())) errors[`${kind}.headers.${i}`] = 'chatbot.err.headerName'
    })
    const names = p.headers.map((h) => h.name.trim().toLowerCase())
    names.forEach((name, i) => {
      if (name && names.indexOf(name) !== i) errors[`${kind}.headers.${i}`] = 'chatbot.err.headerDup'
    })
    const key = p.key.trim()
    if (key && badKey(key)) errors[`${kind}.key`] = 'chatbot.err.key'
  }
  if (!isInt(s.max_tokens) || Number(s.max_tokens) < MAX_TOKENS_MIN) errors['settings.max_tokens'] = 'chatbot.err.maxTokens'
  if (!s.system_prompt.trim()) errors['settings.system_prompt'] = 'chatbot.err.required'
  else if (s.system_prompt.length > PROMPT_MAX) errors['settings.system_prompt'] = 'chatbot.err.promptLong'
  for (const field of ['greeting', 'fallback'] as const) {
    if (!s[field].trim()) errors[`settings.${field}`] = 'chatbot.err.required'
  }
  const rate = Number(s.rate_limit_per_hour)
  if (!isInt(s.rate_limit_per_hour) || rate < RATE_LIMIT.min || rate > RATE_LIMIT.max) errors['settings.rate_limit_per_hour'] = 'chatbot.err.rate'
  if (!s.handoff_message.trim()) errors['settings.handoff_message'] = 'chatbot.err.required'
  const g = draft.guardrail
  if (!URL_RE.test(g.base_url.trim())) errors['guardrail.base_url'] = g.base_url.trim() ? 'chatbot.err.url' : 'chatbot.err.required'
  if (!g.model.trim()) errors['guardrail.model'] = 'chatbot.err.required'
  if (g.key.trim() && badKey(g.key.trim())) errors['guardrail.key'] = 'chatbot.err.key'
  const offTopic = s.guardrails.off_topic_message
  if (offTopic.length > OFF_TOPIC_MAX) errors['settings.guardrails.off_topic_message'] = 'guardrail.err.long'
  else if (s.guardrails.refuse_off_topic && !offTopic.trim()) errors['settings.guardrails.off_topic_message'] = 'chatbot.err.required'
  return errors
}

export type ProviderUpdate = Pick<ProviderRow, 'display_name' | 'base_url' | 'model' | 'supports_tools'> & { extra_headers: Json }
// This form does not edit quick replies yet; the Inbox only reads them.
export type SettingsUpdate = Omit<SettingsRow, 'id' | 'guardrails' | 'quick_replies'> & { guardrails: Json }
export type SavePlan = {
  providers: { kind: ProviderKind; update: ProviderUpdate }[]
  keys: { kind: ProviderKind; key: string | null }[]
  settings: SettingsUpdate | null
  guardrail: Pick<GuardrailRow, 'base_url' | 'model'> | null
  /** A new guardrail key, null to remove it, undefined to leave it. */
  guardrailKey?: string | null
}

const orNull = (s: string) => s.trim() || null

/** What to write for a valid draft. Run order: provider rows, keys, guardrail model, then settings, so a provider switch lands last. */
export function savePlan(saved: Draft, draft: Draft): SavePlan {
  const changed = changes(saved, draft)
  const plan: SavePlan = { providers: [], keys: [], settings: null, guardrail: null }
  for (const kind of PROVIDER_KINDS) {
    const p = draft.providers[kind]
    if (!p) continue
    const fields = changed.filter((path) => path.startsWith(`${kind}.`) && !/\.(key|removeKey)$/.test(path))
    if (fields.length) {
      plan.providers.push({
        kind,
        update: {
          display_name: orNull(p.display_name),
          base_url: orNull(p.base_url),
          model: orNull(p.model),
          supports_tools: p.supports_tools,
          extra_headers: Object.fromEntries(p.headers.map((h) => [h.name.trim(), h.value])),
        },
      })
    }
    if (p.key.trim()) plan.keys.push({ kind, key: p.key.trim() })
    else if (p.removeKey) plan.keys.push({ kind, key: null })
  }
  const g = draft.guardrail
  if (changed.includes('guardrail.base_url') || changed.includes('guardrail.model')) {
    plan.guardrail = { base_url: g.base_url.trim(), model: g.model.trim() }
  }
  if (g.key.trim()) plan.guardrailKey = g.key.trim()
  else if (g.removeKey) plan.guardrailKey = null
  if (changed.some((path) => path.startsWith('settings.'))) {
    const s = draft.settings
    plan.settings = {
      ...s,
      max_tokens: Number(s.max_tokens),
      rate_limit_per_hour: Number(s.rate_limit_per_hour),
    }
  }
  return plan
}
