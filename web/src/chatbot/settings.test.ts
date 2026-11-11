import { expect, it } from 'vitest'
import { SAVED } from './fixture'
import { changes, savePlan, toDraft, validate } from './settings'

it('round-trips saved rows with no changes and no errors', () => {
  const draft = toDraft(SAVED)
  expect(changes(toDraft(SAVED), draft)).toEqual([])
  expect(validate(draft)).toEqual({})
  expect(draft.providers.custom.headers).toEqual([{ name: 'X-Api-Version', value: '1' }])
  expect(savePlan(toDraft(SAVED), draft)).toEqual({ providers: [], keys: [], settings: null })
})

it('mirrors the table checks', () => {
  const draft = toDraft(SAVED)
  draft.settings.system_prompt = 'x'.repeat(6001)
  draft.settings.greeting = '   '
  draft.settings.max_tokens = '63'
  draft.settings.rate_limit_per_hour = '501'
  draft.providers.hermes.base_url = 'http://example.com'
  draft.providers.custom.headers.push({ name: 'Bad Header', value: 'v' }, { name: 'x-api-version', value: '2' })
  draft.providers.openai.key = 'short'
  expect(validate(draft)).toEqual({
    'hermes.base_url': 'chatbot.err.url',
    'openai.key': 'chatbot.err.key',
    'custom.headers.1': 'chatbot.err.headerName',
    'custom.headers.2': 'chatbot.err.headerDup',
    'settings.max_tokens': 'chatbot.err.maxTokens',
    'settings.system_prompt': 'chatbot.err.promptLong',
    'settings.greeting': 'chatbot.err.required',
    'settings.rate_limit_per_hour': 'chatbot.err.rate',
  })
})

it('requires model and base URL only for the active provider', () => {
  const draft = toDraft(SAVED)
  expect(validate(draft)).toEqual({})
  draft.settings.active_provider = 'custom'
  expect(validate(draft)).toEqual({ 'custom.base_url': 'chatbot.err.required', 'custom.model': 'chatbot.err.required' })
  draft.providers.custom.base_url = 'http://localhost:8000/v1'
  draft.providers.custom.model = 'qwen'
  expect(validate(draft)).toEqual({})
})

it('plans provider rows, keys, then settings', () => {
  const saved = toDraft(SAVED)
  const draft = toDraft(SAVED)
  draft.settings.active_provider = 'anthropic'
  draft.providers.anthropic.model = ' claude-opus-5-5 '
  draft.providers.anthropic.key = ' sk-ant-fake-key-1234 '
  draft.providers.openai.removeKey = true
  expect(changes(saved, draft)).toEqual(['settings.active_provider', 'openai.removeKey', 'anthropic.model', 'anthropic.key'])
  const plan = savePlan(saved, draft)
  expect(plan.providers).toEqual([
    { kind: 'anthropic', update: { display_name: 'Claude', base_url: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5', supports_tools: true, extra_headers: {} } },
  ])
  expect(plan.keys).toEqual([
    { kind: 'openai', key: null },
    { kind: 'anthropic', key: 'sk-ant-fake-key-1234' },
  ])
  expect(plan.settings).toMatchObject({ active_provider: 'anthropic', max_tokens: 512, rate_limit_per_hour: 30 })
})
