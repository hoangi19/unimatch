import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { Button, Skeleton } from '../ui/controls'
import { Drawer } from '../ui/Dialog'
import { Icon, type IconName } from '../ui/Icon'
import { useToast } from '../ui/toast-context'
import { attachmentTypes, eventText, isStatus, parseEvent, shortTime, type ConversationRow, type InboxData, type MessageRow, type SystemEvent } from './data'
import { useThread } from './useThread'

type ThreadProps = {
  data: InboxData
  conversation: ConversationRow
  pageName: string
  onBack: () => void
  /** Slot under the log, for the reply composer. */
  footer?: ReactNode
}

export function Thread({ data, conversation, pageName, onBack, footer }: ThreadProps) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const { messages, hasMore, status, loadingOlder, reload, loadOlder } = useThread(data, conversation.id)
  const [infoOpen, setInfoOpen] = useState(false)
  // Fixed per mount: the thread remounts per conversation.
  const [now] = useState(() => new Date())
  const log = useRef<HTMLOListElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // scrollHeight before older messages were added, to keep the view still.
  const anchor = useRef<number | null>(null)
  const name = conversation.customer_name ?? t('inbox.noName')

  useEffect(() => {
    // On the one-pane mobile layout the list just disappeared; move focus to the thread.
    if (window.matchMedia?.('(max-width: 900px)').matches) heading.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const el = log.current
    if (!el) return
    if (anchor.current === null) el.scrollTop = el.scrollHeight
    else el.scrollTop += el.scrollHeight - anchor.current
    anchor.current = null
  }, [messages])

  const older = async () => {
    anchor.current = log.current?.scrollHeight ?? null
    if (!(await loadOlder())) {
      anchor.current = null
      toast({ kind: 'error', title: t('inbox.olderFailed') })
    }
  }

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
        <Button variant="ghost" size="sm" icon="user" label={t('inbox.details')} onClick={() => setInfoOpen(true)} />
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
        <ol ref={log} className="ib-log" aria-label={t('inbox.thread', { name })} aria-busy={status === 'loading'}>
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
                <MessageItem key={m.id} message={m} time={shortTime(m.created_at, lang, now)} />
              ))}
            </>
          )}
        </ol>
      )}
      {footer}
      <Drawer open={infoOpen} onClose={() => setInfoOpen(false)} title={t('inbox.details')}>
        <CustomerInfo conversation={conversation} name={name} pageName={pageName} />
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

const EVENT_ICONS: Record<SystemEvent['code'], IconName> = { handoff: 'alert', takeover: 'user', return_to_bot: 'bot', other: 'info' }

const DELIVERY_ICONS: Record<string, IconName> = { pending: 'clock', sent: 'check', delivered: 'check-check', read: 'eye', failed: 'alert' }
const DELIVERY = ['pending', 'sent', 'delivered', 'read', 'failed'] as const
type Delivery = (typeof DELIVERY)[number]
const isDelivery = (value: string): value is Delivery => (DELIVERY as readonly string[]).includes(value)

function MessageItem({ message: m, time }: { message: MessageRow; time: string }) {
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

/** Basic customer details. The full panel comes with the customer info work. */
function CustomerInfo({ conversation, name, pageName }: { conversation: ConversationRow; name: string; pageName: string }) {
  const { t } = useI18n()
  return (
    <dl className="ctx-dl">
      <dt>{t('inbox.info.name')}</dt>
      <dd>{name}</dd>
      <dt>{t('inbox.info.psid')}</dt>
      <dd>
        <code>{conversation.psid}</code>
      </dd>
      <dt>{t('inbox.info.page')}</dt>
      <dd>{pageName}</dd>
      <dt>{t('inbox.info.status')}</dt>
      <dd>
        <StatusBadge status={conversation.status} />
      </dd>
      {conversation.handoff_reason && (
        <>
          <dt>{t('inbox.info.handoff')}</dt>
          <dd>{conversation.handoff_reason}</dd>
        </>
      )}
    </dl>
  )
}
