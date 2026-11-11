// Test chat beside the Chatbot form: replies come from the `test-chat` Edge Function with the unsaved draft.
// The conversation lives only in this component; nothing is stored or sent to Messenger.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n'
import { Button } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { testChatRequest, type ChatbotApi, type ChatTrace, type ChatTurn, type TestChatResult, type TestErrorKind, type TestPage } from './api'
import { validate, type Draft } from './settings'

// `invalid`: the draft fails validation, so nothing was sent.
type Msg = ChatTurn | { role: 'error'; kind: TestErrorKind | 'invalid'; message?: string }
type BotMsg = ChatTurn & { trace?: ChatTrace }

export function TestChat({ api, draft, dirty }: { api: ChatbotApi; draft: Draft; dirty: boolean }) {
  const { t } = useI18n()
  const [pages, setPages] = useState<TestPage[]>([])
  const [pageId, setPageId] = useState('')
  const [log, setLog] = useState<(Msg | BotMsg)[]>([])
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  // Bumped on reset so a reply still in flight does not land in the new conversation.
  const session = useRef(0)

  useEffect(() => {
    let live = true
    // No Page is fine: the prompt gets an empty page name and no handoff keywords.
    api.loadPages().then(
      (rows) => live && setPages(rows),
      () => {},
    )
    return () => {
      live = false
    }
  }, [api])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log, pending])

  const page = pages.find((p) => p.id === pageId) ?? pages[0]

  const send = async () => {
    const value = text.trim()
    if (!value || pending) return
    const turns = [...log.filter((m): m is ChatTurn => m.role !== 'error'), { role: 'user' as const, text: value }]
    setLog((l) => [...l, { role: 'user', text: value }])
    setText('')
    if (Object.keys(validate(draft)).length) {
      setLog((l) => [...l, { role: 'error', kind: 'invalid' }])
      return
    }
    const id = session.current
    setPending(true)
    const result = await api.testChat(testChatRequest(draft, page, turns.map(({ role, text }) => ({ role, text })))).catch(
      (): TestChatResult => ({ ok: false, error: { kind: 'provider', message: 'Unexpected error' } }),
    )
    if (id !== session.current) return
    setPending(false)
    setLog((l) => [...l, result.ok ? { role: 'bot', text: result.text, trace: result.trace } : { role: 'error', ...result.error }])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    // Telex/VNI: Enter during an IME composition commits the accent; it must not send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    void send()
  }

  const reset = () => {
    session.current++
    setLog([])
    setPending(false)
  }

  return (
    <section className="card chat-panel" aria-labelledby="cb-chat-title">
      <div className="chat-head">
        <span className="chat-avatar">
          <Icon name="bot" />
        </span>
        <div className="chat-head-txt">
          <h3 id="cb-chat-title">{page ? t('chatbot.test.title', { name: page.name }) : t('chatbot.test.titleNoPage')}</h3>
          <div className="sub">
            <span className="pulse" />
            {t('chatbot.test.mode')}
          </div>
        </div>
        {dirty && <span className="chat-draft">{t('chatbot.test.draft')}</span>}
        <Button variant="ghost" size="sm" icon="rotate" label={t('chatbot.test.reset')} onClick={reset} />
      </div>
      {pages.length > 1 && (
        <div className="chat-page">
          <label className="label" htmlFor="cb-chat-page">
            {t('chatbot.test.page')}
          </label>
          <select id="cb-chat-page" className="input" value={page?.id} onChange={(e) => setPageId(e.target.value)}>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="chat-log" ref={logRef} role="log" aria-live="polite" aria-label={t('chatbot.test.log')}>
        {draft.settings.greeting.trim() && (
          <div className="msg bot">
            <div className="msg-body">
              <div className="bubble">{draft.settings.greeting}</div>
            </div>
          </div>
        )}
        {log.map((m, i) =>
          m.role === 'error' ? (
            <div key={i} className="msg system" role="alert">
              <div className="bubble chat-error" title={m.message}>
                <Icon name="alert" />
                {m.kind === 'invalid' ? (
                  <span>{t('chatbot.test.invalid')}</span>
                ) : (
                  <span>
                    {t(`chatbot.conn.err.${m.kind}`)}
                    <br />
                    <span className="hint">{t('chatbot.test.fallbackNote')}</span>
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div key={i} className={`msg ${m.role}`}>
              <div className="msg-body">
                <div className="bubble">{m.text}</div>
                {'trace' in m && m.trace && <Debug trace={m.trace} />}
              </div>
            </div>
          ),
        )}
        {pending && (
          <div className="msg bot">
            <div className="msg-body">
              <div className="bubble typing" role="status" aria-label={t('chatbot.test.typing')}>
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
        )}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <textarea
          id="cb-chat-input"
          aria-label={t('chatbot.test.input')}
          rows={1}
          maxLength={2000}
          placeholder={t('chatbot.test.ph')}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="btn btn-cta" disabled={pending || !text.trim()}>
          <Icon name="send" />
          <span>{t('chatbot.test.send')}</span>
        </button>
      </form>
      <div className="chat-hint">
        <span>{t('chatbot.test.hint')}</span>
        <span className="mono">
          {draft.settings.active_provider} · {draft.providers[draft.settings.active_provider].model || '—'}
        </span>
      </div>
    </section>
  )
}

function Debug({ trace }: { trace: ChatTrace }) {
  const { t } = useI18n()
  return (
    <details className="debug">
      <summary>
        {t('chatbot.test.debug')}
        <Icon name="chevron-down" className="ic chev" />
      </summary>
      <div className="debug-body">
        <div className="debug-meta">
          <span>
            {t('chatbot.test.provider')}: <span className="mono">{trace.provider}</span>
          </span>
          {trace.model && (
            <span>
              {t('chatbot.test.model')}: <span className="mono">{trace.model}</span>
            </span>
          )}
          {trace.latencyMs !== undefined && <span>{t('chatbot.test.latency', { ms: trace.latencyMs })}</span>}
          {trace.tokens && <span>{t('chatbot.test.tokens', { in: trace.tokens.inputTokens, out: trace.tokens.outputTokens })}</span>}
          <span>{trace.handoff ? t('chatbot.test.handoff', { keyword: trace.handoff.keyword }) : t('chatbot.test.noHandoff')}</span>
        </div>
      </div>
    </details>
  )
}
