import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { Button, Skeleton } from '../ui/controls'
import { Drawer } from '../ui/Dialog'
import { Icon, type IconName } from '../ui/Icon'
import { useToast } from '../ui/toast-context'
import { CustomerInfo } from './CustomerInfo'
import { Trace } from './Trace'
import {
  attachmentTypes,
  eventText,
  isStatus,
  parseEvent,
  windowOpen,
  type ConversationRow,
  type InboxData,
  type MessageRow,
  type Mode,
  type SystemEvent,
} from './data'
import { LOCAL_PREFIX, useReply } from './useReply'
import { useThread } from './useThread'
import { useWide } from './useWide'

const NEAR_BOTTOM = 48

/** What the thread hands its composer. */
export type ReplyControls = {
  send(text: string): void
  setMode(mode: Mode): void
  /** A status change is in flight. */
  busy: boolean
  /** Messenger's 24-hour reply window has closed for this customer. */
  windowClosed: boolean
}

type ThreadProps = {
  data: InboxData
  conversation: ConversationRow
  pageName: string
  onBack: () => void
  /** Called with the updated row after the admin changed its status. */
  onChange?: (conversation: ConversationRow) => void
  /** Slot under the log, for the reply composer. */
  footer?: (reply: ReplyControls) => ReactNode
}

export function Thread({ data, conversation, pageName, onBack, onChange, footer }: ThreadProps) {
  const { t, fmt } = useI18n()
  const toast = useToast()
  const thread = useThread(data, conversation.id)
  const { messages, hasMore, status, loadingOlder, reload, loadOlder } = thread
  const reply = useReply(data, conversation.id, thread)
  const [busy, setBusy] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const wide = useWide()
  // Fixed per mount: the thread remounts per conversation.
  const [now] = useState(() => new Date())
  const log = useRef<HTMLOListElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // scrollHeight before older messages were added, to keep the view still.
  const anchor = useRef<number | null>(null)
  // Updated on scroll, so it holds the position from before new messages render.
  const atBottom = useRef(true)
  const lastId = useRef<string | null>(null)
  const [newBelow, setNewBelow] = useState(false)
  const name = conversation.customer_name ?? t('inbox.noName')

  useEffect(() => {
    // On the one-pane mobile layout the list just disappeared; move focus to the thread.
    if (window.matchMedia?.('(max-width: 900px)').matches) heading.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const el = log.current
    if (!el) return
    const last = messages.at(-1)?.id ?? null
    const appended = lastId.current !== null && last !== lastId.current
    lastId.current = last
    if (anchor.current !== null) el.scrollTop += el.scrollHeight - anchor.current
    // The admin's own new message always scrolls into view.
    else if (atBottom.current || (appended && last?.startsWith(LOCAL_PREFIX))) el.scrollTop = el.scrollHeight
    // Reading older messages: keep the view still and point at what arrived.
    else if (appended) setNewBelow(true)
    anchor.current = null
  }, [messages])

  const onScroll = () => {
    const el = log.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
    if (atBottom.current) setNewBelow(false)
  }

  const toBottom = () => {
    const el = log.current
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el?.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
    setNewBelow(false)
  }

  const older = async () => {
    anchor.current = log.current?.scrollHeight ?? null
    if (!(await loadOlder())) {
      anchor.current = null
      toast({ kind: 'error', title: t('inbox.olderFailed') })
    }
  }

  const setMode = async (mode: Mode) => {
    setBusy(true)
    try {
      await data.setMode(conversation.id, mode)
      onChange?.({ ...conversation, status: mode, ...(mode === 'bot' && { handoff_reason: null }) })
      await thread.sync()
    } catch {
      toast({ kind: 'error', title: t('inbox.compose.modeFailed') })
    } finally {
      setBusy(false)
    }
  }

  const send = async (text: string, retry?: MessageRow) => {
    const result = await reply.send(text, conversation.last_customer_message_at, retry)
    if (!result.ok) toast({ kind: 'error', title: t(`inbox.compose.error.${result.error.kind}`) })
  }

  const current = conversation.status
  return (
    <>
      <header className="ib-head">
        <Button variant="ghost" icon="chevron-left" label={t('inbox.back')} className="ib-back" onClick={onBack} />
        <Avatar conversation={conversation} />
        <div className="ib-who">
          <h2 ref={heading} tabIndex={-1}>
            {name}
          </h2>
          <div className="sub">
            <span>{pageName}</span>
            <StatusBadge status={conversation.status} />
          </div>
        </div>
        <div className="ib-actions">
          {current === 'human' && (
            <Button size="sm" icon="bot" disabled={busy} onClick={() => void setMode('bot')}>
              {t('inbox.compose.return')}
            </Button>
          )}
          {(current === 'bot' || current === 'needs_human') && (
            <Button variant="primary" size="sm" icon="user" disabled={busy} onClick={() => void setMode('human')}>
              {t('inbox.compose.takeOver')}
            </Button>
          )}
          {current === 'closed' ? (
            <Button size="sm" icon="rotate" disabled={busy} aria-label={t('inbox.compose.reopenAria')} onClick={() => void setMode('bot')}>
              {t('inbox.compose.reopen')}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" icon="check" disabled={busy} aria-label={t('inbox.compose.closeAria')} onClick={() => void setMode('closed')}>
              <span className="hide-sm">{t('inbox.compose.close')}</span>
            </Button>
          )}
          {!wide && <Button variant="ghost" size="sm" icon="user" label={t('inbox.details')} onClick={() => setInfoOpen(true)} />}
        </div>
      </header>
      {status === 'error' ? (
        <div className="ib-placeholder">
          <div className="callout callout-danger" role="alert">
            <Icon name="alert" />
            <div className="callout-body">{t('inbox.threadError')}</div>
            <Button size="sm" icon="rotate" onClick={reload}>
              {t('inbox.retry')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="ib-log-wrap">
        <ol ref={log} className="ib-log" aria-label={t('inbox.thread', { name })} aria-busy={status === 'loading'} onScroll={onScroll}>
          {status === 'loading' ? (
            <ThreadSkeleton />
          ) : (
            <>
              {hasMore && (
                <li className="ib-older">
                  <Button size="sm" variant="ghost" icon="rotate" disabled={loadingOlder} onClick={() => void older()}>
                    {t(loadingOlder ? 'inbox.loadingOlder' : 'inbox.loadOlder')}
                  </Button>
                </li>
              )}
              {!messages.length && <li className="ib-none">{t('inbox.noMessages')}</li>}
              {messages.map((m) => (
                <MessageItem key={m.id} message={m} time={fmt.shortTime(m.created_at, now)} onRetry={(failed) => void send(failed.text ?? '', failed)} />
              ))}
            </>
          )}
        </ol>
        <div aria-live="polite">
          {newBelow && (
            <button type="button" className="ib-pill" onClick={toBottom}>
              <Icon name="arrow-down" />
              {t('inboxLive.newMessages')}
            </button>
          )}
        </div>
        </div>
      )}
      {footer?.({
        send: (text) => void send(text),
        setMode: (mode) => void setMode(mode),
        busy,
        windowClosed: !windowOpen(conversation.last_customer_message_at) || reply.windowClosedBy(conversation.last_customer_message_at),
      })}
      <Drawer open={infoOpen && !wide} onClose={() => setInfoOpen(false)} title={t('inbox.details')}>
        {/* Mounted only while open: the wide layout shows its own copy, and closing saves a pending note. */}
        {infoOpen && !wide && <CustomerInfo data={data} conversation={conversation} name={name} pageName={pageName} />}
      </Drawer>
    </>
  )
}

function ThreadSkeleton() {
  return [70, 45, 60].map((width, i) => (
    <li key={i} className={i % 2 ? 'im im-bot' : 'im im-user'}>
      <Skeleton width={`${width}%`} height={36} />
    </li>
  ))
}

const EVENT_ICONS: Record<SystemEvent['code'], IconName> = { handoff: 'alert', takeover: 'user', return_to_bot: 'bot', close: 'check', reopen: 'rotate', other: 'info' }

const DELIVERY_ICONS: Record<string, IconName> = { pending: 'clock', sent: 'check', delivered: 'check-check', read: 'eye', failed: 'alert' }
const DELIVERY = ['pending', 'sent', 'delivered', 'read', 'failed'] as const
type Delivery = (typeof DELIVERY)[number]
const isDelivery = (value: string): value is Delivery => (DELIVERY as readonly string[]).includes(value)

function MessageItem({ message: m, time, onRetry }: { message: MessageRow; time: string; onRetry: (m: MessageRow) => void }) {
  const { t } = useI18n()
  if (m.sender_kind === 'system') {
    const event = parseEvent(m.event)
    return (
      <li className={event.code === 'handoff' ? 'ev warn' : 'ev'}>
        <Icon name={EVENT_ICONS[event.code]} />
        <span>{eventText(t, event, m.text)}</span>
        <time dateTime={m.created_at}>{time}</time>
      </li>
    )
  }
  const outgoing = m.sender_kind === 'bot' || m.sender_kind === 'admin'
  const failed = m.delivery_status === 'failed'
  return (
    <li className={`im im-${outgoing ? m.sender_kind : 'user'}${outgoing && failed ? ' is-failed' : ''}`}>
      <div className="im-body">
        {m.text && <div className="bubble">{m.text}</div>}
        {m.sender_kind === 'bot' && <Trace trace={m.trace} />}
        {attachmentTypes(m.attachments).map((type, i) => (
          <span key={i} className="im-attach">
            <Icon name="paperclip" />
            {t(`inbox.attachment.${type}`)}
          </span>
        ))}
        <div className="im-meta">
          {outgoing && <span>{t(m.sender_kind === 'bot' ? 'inbox.from.bot' : 'inbox.from.admin')}</span>}
          <time dateTime={m.created_at}>{time}</time>
          {outgoing && isDelivery(m.delivery_status) && (
            <span className={failed ? 'im-state failed' : 'im-state'} title={(failed && m.delivery_error) || undefined}>
              <Icon name={DELIVERY_ICONS[m.delivery_status]} />
              {t(`inbox.delivery.${m.delivery_status}`)}
            </span>
          )}
          {failed && m.sender_kind === 'admin' && m.text && (
            <button type="button" className="link-btn" onClick={() => onRetry(m)}>
              {t('inbox.compose.retry')}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n()
  if (!isStatus(status)) return null
  const tone = { needs_human: ' b-warning', bot: '', human: ' b-success', closed: '' }[status]
  return <span className={`badge${tone}`}>{t(`inbox.status.${status}`)}</span>
}

export function Avatar({ conversation }: { conversation: ConversationRow }) {
  const initials = (conversation.customer_name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((word) => word[0].toUpperCase())
    .join('')
  return conversation.customer_picture_url ? (
    <img className="p-av" src={conversation.customer_picture_url} alt="" />
  ) : (
    <span className="p-av" aria-hidden="true">
      {initials || '?'}
    </span>
  )
}
