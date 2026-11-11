import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { ToastProvider } from '../ui/ToastProvider'
import type { ChatbotApi } from './api'
import { Chatbot } from './Chatbot'
import { SAVED } from './fixture'
import type { Saved, SavePlan } from './settings'

function stubApi(first: Saved = SAVED) {
  let rows = structuredClone(first)
  const api: ChatbotApi = {
    load: vi.fn(async () => structuredClone(rows)),
    save: vi.fn(async (plan: SavePlan) => {
      // Mimic the DB: a saved key comes back only as its hint.
      rows = {
        settings: plan.settings ? { ...rows.settings, ...plan.settings } : rows.settings,
        guardrail: {
          ...rows.guardrail,
          ...plan.guardrail,
          ...(plan.guardrailKey !== undefined && {
            key_hint: plan.guardrailKey && `…${plan.guardrailKey.slice(-4)}`,
            key_saved_at: plan.guardrailKey ? '2026-11-12T00:00:00Z' : null,
          }),
        },
        providers: rows.providers.map((row) => {
          const key = plan.keys.find((k) => k.kind === row.kind)
          if (!key) return row
          return key.key === null
            ? { ...row, key_hint: null, key_saved_at: null, key_secret_id: null }
            : { ...row, key_hint: `sk-…${key.key.slice(-4)}`, key_saved_at: '2026-11-12T00:00:00Z' }
        }),
      }
    }),
    testConnection: vi.fn(async () => ({ ok: false as const, error: { kind: 'bad_config' as const, message: 'No API key' } })),
    testGuardrail: vi.fn(async (text?: string) =>
      text?.includes('quản lý')
        ? { ok: true as const, latencyMs: 640, model: 'Quyet-1.0-Large', decision: 'complaint' as const }
        : { ok: false as const, error: { kind: 'auth' as const, message: 'API key rejected' } },
    ),
    loadPages: vi.fn(async () => []),
    testChat: vi.fn(async () => ({ ok: false as const, error: { kind: 'bad_config' as const, message: 'No API key' } })),
  }
  return api
}

// Both the AI provider and the guardrail model cards have an API key field and a Test connection button.
const card = (title: string) => within(screen.getByRole('heading', { name: title }).closest('section')!)
const ai = () => card('AI provider')
const guard = () => card('Guardrail model')

async function renderChatbot(api: ChatbotApi) {
  localStorage.setItem('um-lang', 'en')
  render(
    <I18nProvider>
      <ToastProvider>
        <Chatbot api={api} />
      </ToastProvider>
    </I18nProvider>,
  )
  await screen.findByRole('radio', { name: /Claude/ })
}

it('sends a new key once, then shows only its hint', async () => {
  const api = stubApi()
  await renderChatbot(api)
  fireEvent.click(screen.getByRole('radio', { name: /Claude/ }))
  expect(screen.getByText(/Claude ignores temperature/)).toBeTruthy()

  fireEvent.change(ai().getByLabelText('API key'), { target: { value: 'sk-ant-fake-test-9999' } })
  expect(screen.getByText('Unsaved changes: 2')).toBeTruthy()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' })))

  expect(api.save).toHaveBeenCalledTimes(1)
  const plan = vi.mocked(api.save).mock.calls[0][0]
  expect(plan.keys).toEqual([{ kind: 'anthropic', key: 'sk-ant-fake-test-9999' }])
  expect(plan.settings?.active_provider).toBe('anthropic')
  expect(screen.getByTestId('key-hint').textContent).toBe('sk-…9999')
  expect(screen.queryByDisplayValue('sk-ant-fake-test-9999')).toBeNull()
  expect(document.body.innerHTML).not.toContain('sk-ant-fake-test-9999')
  expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull()
})

it('marks a saved key for removal until Save', async () => {
  const api = stubApi()
  await renderChatbot(api)
  fireEvent.click(screen.getByRole('radio', { name: /ChatGPT/ }))
  fireEvent.click(ai().getByRole('button', { name: 'Remove' }))
  expect(screen.getByText('Will be removed when you save.')).toBeTruthy()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' })))
  expect(vi.mocked(api.save).mock.calls[0][0].keys).toEqual([{ kind: 'openai', key: null }])
  expect(ai().getByLabelText('API key')).toBeTruthy()
})

it('does not save invalid input and focuses the first bad field', async () => {
  const api = stubApi()
  await renderChatbot(api)
  const greeting = screen.getByLabelText('Greeting')
  fireEvent.change(greeting, { target: { value: '  ' } })
  fireEvent.change(screen.getByLabelText('Max messages per user per hour'), { target: { value: '900' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' })))
  expect(api.save).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(greeting)
  expect(greeting.getAttribute('aria-invalid')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
  expect((greeting as HTMLTextAreaElement).value).toBe('Hi')
})

it('reports the test-connection result for the active provider', async () => {
  const api = stubApi()
  await renderChatbot(api)
  await act(async () => fireEvent.click(ai().getByRole('button', { name: 'Test connection' })))
  expect(api.testConnection).toHaveBeenCalledWith('hermes')
  expect(screen.getByText(/Not set up yet/)).toBeTruthy()
})

it('adds refused topics with Enter and rejects duplicates', async () => {
  await renderChatbot(stubApi())
  const input = screen.getByLabelText('Refused topics')
  fireEvent.change(input, { target: { value: 'Crypto' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByRole('button', { name: 'Remove Crypto' })).toBeTruthy()
  fireEvent.change(input, { target: { value: 'politics' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByText('“politics” is already in the list.')).toBeTruthy()
})

it('saves the guardrail model config and key, and shows only the hint after reload', async () => {
  const api = stubApi()
  await renderChatbot(api)
  fireEvent.click(guard().getByLabelText(/Turn on the guardrail model/))
  fireEvent.change(guard().getByLabelText('Model'), { target: { value: 'Quyet-1.0-Large-v2' } })
  fireEvent.change(guard().getByLabelText('API key'), { target: { value: 'fpt-fake-test-4321' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' })))

  const plan = vi.mocked(api.save).mock.calls[0][0]
  expect(plan.guardrail).toEqual({ base_url: 'https://mkp-api.fptcloud.com/v1', model: 'Quyet-1.0-Large-v2' })
  expect(plan.guardrailKey).toBe('fpt-fake-test-4321')
  expect(plan.keys).toEqual([])
  expect(plan.settings?.guardrails).toMatchObject({ model_enabled: true, handoff_on_complaint: true, handoff_on_human_request: true, refuse_off_topic: false })
  expect(guard().getByTestId('key-hint').textContent).toBe('…4321')
  expect(document.body.innerHTML).not.toContain('fpt-fake-test-4321')
})

it('requires an off-topic message only when that check is on', async () => {
  const api = stubApi()
  await renderChatbot(api)
  expect(guard().queryByLabelText('Default reply for off-topic messages')).toBeNull()
  fireEvent.click(guard().getByLabelText(/Off-topic or abusive/))
  const message = guard().getByLabelText('Default reply for off-topic messages')
  fireEvent.change(message, { target: { value: ' ' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' })))
  expect(api.save).not.toHaveBeenCalled()
  expect(message.getAttribute('aria-invalid')).toBe('true')
})

it('tests the guardrail connection and shows a decision for a sentence', async () => {
  const api = stubApi()
  await renderChatbot(api)
  await act(async () => fireEvent.click(guard().getByRole('button', { name: 'Test connection' })))
  expect(api.testGuardrail).toHaveBeenCalledWith(undefined)
  expect(guard().getByText('The API key was rejected.')).toBeTruthy()

  fireEvent.change(guard().getByLabelText('Try a sentence'), { target: { value: 'Chậm quá, cho tôi gặp quản lý' } })
  await act(async () => fireEvent.click(guard().getByRole('button', { name: 'See decision' })))
  expect(api.testGuardrail).toHaveBeenLastCalledWith('Chậm quá, cho tôi gặp quản lý')
  expect(guard().getByText('Decision: complaint · 640 ms')).toBeTruthy()
})
