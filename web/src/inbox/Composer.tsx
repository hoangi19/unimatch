import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n'
import { Button } from '../ui/controls'
import { Icon } from '../ui/Icon'
import type { ConversationRow, InboxData } from './data'
import type { ReplyControls } from './Thread'

// Matches send-message's MAX_TEXT.
const MAX_TEXT = 2000

type ComposerProps = ReplyControls & { data: InboxData; conversation: ConversationRow }

/** The reply box under a thread. Only an admin-owned ('human') conversation can be written to. */
export function Composer({ data, conversation, send, setMode, busy, windowClosed }: ComposerProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [quick, setQuick] = useState<string[]>([])
  const box = useRef<HTMLTextAreaElement>(null)
  const quickButton = useRef<HTMLButtonElement>(null)
  const popId = useId()
  const windowId = useId()
  const name = conversation.customer_name ?? t('inbox.noName')

  useEffect(() => {
    data.loadQuickReplies().then(setQuick, () => setQuick([]))
  }, [data])

  if (conversation.status !== 'human') {
    const closed = conversation.status === 'closed'
    const needs = conversation.status === 'needs_human'
    return (
      <div className="ib-composer">
        <div className="ib-hintbar" role="status">
          <Icon name={closed ? 'check' : needs ? 'alert' : 'bot'} />
          <span>{closed ? t('inbox.compose.hintClosed') : needs ? t('inbox.compose.hintNeeds', { name }) : t('inbox.compose.hintBot')}</span>
          {closed ? (
            <Button size="sm" disabled={busy} onClick={() => setMode('bot')}>
              {t('inbox.compose.reopen')}
            </Button>
          ) : (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => setMode('human')}>
              {t('inbox.compose.takeOver')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const submit = () => {
    const text = draft.trim()
    if (!text || windowClosed) return
    setDraft('')
    send(text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    // Telex/VNI: Enter during an IME composition commits the accent; it must not send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    if (!e.repeat) submit()
  }

  const closeQuick = () => {
    setQuickOpen(false)
    quickButton.current?.focus()
  }

  const pick = (text: string) => {
    setDraft((d) => (d.trim() ? `${d.trimEnd()} ${text}` : text))
    setQuickOpen(false)
    box.current?.focus()
  }

  return (
    <div className="ib-composer" onKeyDown={(e) => e.key === 'Escape' && quickOpen && closeQuick()}>
      {windowClosed && (
        <div className="callout callout-warning" id={windowId} role="status">
          <Icon name="clock" />
          <div className="callout-body">{t('inbox.compose.window', { name })}</div>
        </div>
      )}
      <form
        className="ib-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {quick.length > 0 && (
          <div className="ib-tools">
            <Button
              ref={quickButton}
              variant="ghost"
              size="sm"
              icon="sparkles"
              aria-expanded={quickOpen}
              aria-controls={popId}
              disabled={windowClosed}
              onClick={() => setQuickOpen((o) => !o)}
            >
              {t('inbox.compose.quick')}
              <Icon name="chevron-down" />
            </Button>
          </div>
        )}
        <div className="ib-row">
          <textarea
            ref={box}
            aria-label={t('inbox.compose.label', { name })}
            aria-describedby={windowClosed ? windowId : undefined}
            rows={1}
            maxLength={MAX_TEXT}
            placeholder={t('inbox.compose.placeholder')}
            autoComplete="off"
            disabled={windowClosed}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="btn btn-cta" disabled={windowClosed || !draft.trim()}>
            <Icon name="send" />
            <span>{t('inbox.compose.send')}</span>
          </button>
        </div>
      </form>
      {quickOpen && (
        <div className="ib-pop" id={popId}>
          <div className="pop-title">{t('inbox.compose.quick')}</div>
          <ul className="pop-list">
            {quick.map((q, i) => (
              <li key={i}>
                <button type="button" className="pop-item" onClick={() => pick(q)}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
