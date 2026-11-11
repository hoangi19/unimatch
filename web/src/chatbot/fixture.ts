import type { Saved } from './settings'

// Saved rows shaped like the hosted seed, with one saved OpenAI key hint.
export const SAVED: Saved = {
  settings: {
    id: true,
    active_provider: 'hermes',
    temperature: 0.4,
    max_tokens: 512,
    system_prompt: 'You are UniMatch for {{page_name}}.',
    greeting: 'Hi',
    fallback: 'No match',
    handoff_message: 'A person will reply',
    language: 'auto',
    rate_limit_per_hour: 30,
    guardrails: { refused_topics: ['Politics'], handoff_on_keyword: true, handoff_on_low_confidence: true, handoff_on_complaint: false },
  },
  providers: [
    { kind: 'hermes', display_name: 'Hermes', base_url: 'https://inference-api.nousresearch.com/v1', model: 'hermes-4-70b', extra_headers: {}, supports_tools: true, key_hint: null, key_saved_at: null, key_secret_id: null },
    { kind: 'openai', display_name: 'ChatGPT', base_url: 'https://api.openai.com/v1', model: 'gpt-5-mini', extra_headers: {}, supports_tools: true, key_hint: 'sk-…abcd', key_saved_at: '2026-11-01T00:00:00Z', key_secret_id: '00000000-0000-0000-0000-000000000001' },
    { kind: 'anthropic', display_name: 'Claude', base_url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', extra_headers: {}, supports_tools: true, key_hint: null, key_saved_at: null, key_secret_id: null },
    { kind: 'custom', display_name: null, base_url: null, model: null, extra_headers: { 'X-Api-Version': '1' }, supports_tools: true, key_hint: null, key_saved_at: null, key_secret_id: null },
  ],
}
