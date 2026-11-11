// Chatbot tab data access as the signed-in admin (RLS). Injected so tests and the shell never need a live client.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../lib/database.types'
import type { Draft, ProviderKind, Saved, SavePlan } from './settings'

export type TestErrorKind = 'auth' | 'rate_limit' | 'timeout' | 'bad_config' | 'bad_request' | 'provider' | 'refused'
export type TestResult = { ok: true; latencyMs: number; model: string } | { ok: false; error: { kind: TestErrorKind; message: string } }

export type TestPage = { id: string; name: string; handoff_keywords: string[] }
export type ChatTurn = { role: 'user' | 'bot'; text: string }
/** Body of the `test-chat` Edge Function. Never carries an API key: the function uses the saved one. */
export type TestChatRequest = {
  settings: { system_prompt: string; temperature: number; max_tokens: number; language: string; handoff_message: string; guardrails: Json }
  provider: { kind: ProviderKind; base_url: string; model: string; extra_headers: Record<string, string> }
  page: { name: string; handoff_keywords: string[] }
  messages: ChatTurn[]
}
export type ChatTrace = {
  provider: ProviderKind
  model?: string
  latencyMs?: number
  tokens?: { inputTokens: number; outputTokens: number }
  handoff: { reason: 'keyword'; keyword: string } | null
}
export type TestChatResult = { ok: true; text: string; trace: ChatTrace } | { ok: false; error: { kind: TestErrorKind; message: string } }

export type ChatbotApi = {
  load(): Promise<Saved>
  /** Applies the plan in order; throws on the first failure with the DB message (never the key). */
  save(plan: SavePlan): Promise<void>
  /** `test-connection` Edge Function: checks the provider's saved config. */
  testConnection(kind: ProviderKind): Promise<TestResult>
  /** Pages the test chat can play, for the prompt's page name and handoff keywords. */
  loadPages(): Promise<TestPage[]>
  /** `test-chat` Edge Function: one dry-run reply with the draft; nothing reaches Messenger. */
  testChat(req: TestChatRequest): Promise<TestChatResult>
}

export function createChatbotApi(db: SupabaseClient<Database>): ChatbotApi {
  return {
    async load() {
      const [settings, providers] = await Promise.all([
        db.from('bot_settings').select('*').single(),
        db.from('ai_providers').select('*'),
      ])
      if (settings.error) throw settings.error
      if (providers.error) throw providers.error
      return { settings: settings.data, providers: providers.data }
    },
    async save(plan) {
      for (const { kind, update } of plan.providers) {
        const { error } = await db.from('ai_providers').update(update).eq('kind', kind)
        if (error) throw error
      }
      for (const { kind, key } of plan.keys) {
        const { error } = key === null
          ? await db.rpc('remove_provider_key', { p_kind: kind })
          : await db.rpc('set_provider_key', { p_kind: kind, p_key: key })
        if (error) throw new Error(error.message)
      }
      if (plan.settings) {
        const { error } = await db.from('bot_settings').update(plan.settings).eq('id', true)
        if (error) throw error
      }
    },
    async testConnection(kind) {
      const { data } = await db.functions.invoke<TestResult>('test-connection', { body: { kind } })
      return data && typeof data.ok === 'boolean' ? data : { ok: false, error: { kind: 'provider', message: 'Unexpected response' } }
    },
    async loadPages() {
      const { data, error } = await db.from('pages').select('id, name, handoff_keywords').order('name')
      if (error) throw error
      return data
    },
    async testChat(req) {
      const { data } = await db.functions.invoke<TestChatResult>('test-chat', { body: req })
      return data && typeof data.ok === 'boolean' ? data : { ok: false, error: { kind: 'provider', message: 'Unexpected response' } }
    },
  }
}

// Matches the function's bound; older turns drop off first.
const MAX_TURNS = 40

/** The function body for a draft. Built from the form so unsaved edits are tested; the key field is never read. */
export function testChatRequest(draft: Draft, page: TestPage | undefined, messages: ChatTurn[]): TestChatRequest {
  const s = draft.settings
  const p = draft.providers[s.active_provider]
  return {
    settings: {
      system_prompt: s.system_prompt,
      temperature: s.temperature,
      max_tokens: Number(s.max_tokens),
      language: s.language,
      handoff_message: s.handoff_message,
      guardrails: s.guardrails,
    },
    provider: {
      kind: s.active_provider,
      base_url: p.base_url.trim(),
      model: p.model.trim(),
      extra_headers: Object.fromEntries(p.headers.map((h) => [h.name.trim(), h.value])),
    },
    page: { name: page?.name ?? '', handoff_keywords: page?.handoff_keywords ?? [] },
    messages: messages.slice(-MAX_TURNS),
  }
}
