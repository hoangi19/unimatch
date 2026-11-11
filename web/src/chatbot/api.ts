// Chatbot tab data access as the signed-in admin (RLS). Injected so tests and the shell never need a live client.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../lib/database.types'
import type { ProviderKind, Saved, SavePlan } from './settings'

export type TestErrorKind = 'auth' | 'rate_limit' | 'timeout' | 'bad_config' | 'bad_request' | 'provider' | 'refused'
export type TestResult = { ok: true; latencyMs: number; model: string } | { ok: false; error: { kind: TestErrorKind; message: string } }

export type ChatbotApi = {
  load(): Promise<Saved>
  /** Applies the plan in order; throws on the first failure with the DB message (never the key). */
  save(plan: SavePlan): Promise<void>
  /** `test-connection` Edge Function: checks the provider's saved config. */
  testConnection(kind: ProviderKind): Promise<TestResult>
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
  }
}
