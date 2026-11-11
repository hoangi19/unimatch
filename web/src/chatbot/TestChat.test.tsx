import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import type { ChatbotApi, TestChatRequest, TestChatResult } from './api'
import { SAVED } from './fixture'
import { toDraft, type Draft } from './settings'
import { TestChat } from './TestChat'

const REPLY: TestChatResult = {
  ok: true,
  text: 'Có ạ, mình gợi ý vài việc.',
  trace: { provider: 'hermes', model: 'hermes-4-70b', latencyMs: 812, tokens: { inputTokens: 120, outputTokens: 18 }, handoff: null },
}

function setup(result: TestChatResult = REPLY, draft: Draft = toDraft(SAVED)) {
  const api: ChatbotApi = {
    load: vi.fn(),
    save: vi.fn(),
    testConnection: vi.fn(),
    testGuardrail: vi.fn(),
    loadPages: vi.fn(async () => [{ id: 'p1', name: 'UniMatch', handoff_keywords: ['gap nguoi that'] }]),
    testChat: vi.fn(async () => result),
  }
  localStorage.setItem('um-lang', 'en')
  render(
    <I18nProvider>
      <TestChat api={api} draft={draft} dirty={false} />
    </I18nProvider>,
  )
  return { api, box: screen.getByLabelText('Message') }
}

const sent = (api: ChatbotApi) => vi.mocked(api.testChat).mock.calls.map(([req]) => req as TestChatRequest)

it('Enter during an IME composition does not send; Shift+Enter does not send; Enter sends', async () => {
  const { api, box } = setup()
  await screen.findByText('Test chat · UniMatch')
  fireEvent.change(box, { target: { value: 'Có việc data không' } })
  fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })
  fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
  expect(api.testChat).not.toHaveBeenCalled()

  await act(async () => {
    fireEvent.keyDown(box, { key: 'Enter' })
  })
  expect(api.testChat).toHaveBeenCalledTimes(1)
  expect(await screen.findByText(REPLY.ok ? REPLY.text : '')).toBeTruthy()
  fireEvent.click(screen.getByText('Debug'))
  expect(screen.getByText('812 ms')).toBeTruthy()
  expect(screen.getByText('120 tokens in · 18 out')).toBeTruthy()
  expect(screen.getByText('No handoff')).toBeTruthy()
})

it('sends the unsaved draft, the page and the history, never a key', async () => {
  const draft = toDraft(SAVED)
  draft.settings.system_prompt = 'Unsaved prompt'
  draft.providers.hermes.model = 'hermes-4-405b'
  draft.providers.hermes.key = 'typed-but-unsaved-placeholder'
  draft.providers.hermes.headers = [{ name: ' X-Title ', value: 'UniMatch' }]
  const { api, box } = setup(REPLY, draft)
  await screen.findByText('Test chat · UniMatch')
  for (const text of ['xin chào', 'việc ở HCM?']) {
    fireEvent.change(box, { target: { value: text } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
  }
  const [, second] = sent(api)
  expect(second.settings.system_prompt).toBe('Unsaved prompt')
  expect(second.settings.max_tokens).toBe(512)
  expect(second.provider).toEqual({ kind: 'hermes', base_url: 'https://inference-api.nousresearch.com/v1', model: 'hermes-4-405b', extra_headers: { 'X-Title': 'UniMatch' } })
  expect(second.page).toEqual({ name: 'UniMatch', handoff_keywords: ['gap nguoi that'] })
  expect(second.messages).toEqual([
    { role: 'user', text: 'xin chào' },
    { role: 'bot', text: 'Có ạ, mình gợi ý vài việc.' },
    { role: 'user', text: 'việc ở HCM?' },
  ])
  expect(JSON.stringify(sent(api))).not.toContain('typed-but-unsaved')
})

it('shows provider errors with the fallback note', async () => {
  const { box } = setup({ ok: false, error: { kind: 'bad_config', message: 'No API key saved for this provider' } })
  fireEvent.change(box, { target: { value: 'hi' } })
  await act(async () => {
    fireEvent.keyDown(box, { key: 'Enter' })
  })
  expect(screen.getByRole('alert').textContent).toContain('Not set up yet')
  expect(screen.getByRole('alert').textContent).toContain('fallback message')
})

it('an invalid draft is not sent', async () => {
  const draft = toDraft(SAVED)
  draft.settings.system_prompt = ' '
  const { api, box } = setup(REPLY, draft)
  fireEvent.change(box, { target: { value: 'hi' } })
  await act(async () => {
    fireEvent.keyDown(box, { key: 'Enter' })
  })
  expect(api.testChat).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('Fix the highlighted settings')
})
