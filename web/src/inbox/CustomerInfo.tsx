import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { Button, Skeleton } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { NOTES_DEBOUNCE_MS, reasonText, type ConversationDetails, type ConversationRow, type InboxData } from './data'
import { Avatar, StatusBadge } from './Thread'

type Save = 'idle' | 'saving' | 'saved' | 'error'

/** Profile, stats and internal notes of one conversation. Mount it per conversation (`key`). */
export function CustomerInfo({ data, conversation, name, pageName }: { data: InboxData; conversation: ConversationRow; name: string; pageName: string }) {
  const { t, fmt } = useI18n()
  const [details, setDetails] = useState<ConversationDetails | null | 'error'>(null)
  const id = conversation.id

  const load = () => {
    setDetails(null)
    data.loadDetails(id).then(setDetails, () => setDetails('error'))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [data, id])

  const ready = details && details !== 'error' ? details : null
  const language = ready?.language
  const stats = ready && [
    [ready.stats.user, t('inbox.ctx.fromUser')],
    [ready.stats.bot, t('inbox.ctx.fromBot')],
    [ready.stats.admin, t('inbox.ctx.fromAdmin')],
    [ready.stats.handoffs, t('inbox.ctx.handoffs')],
  ] as const

  return (
    <div className="ctx">
      <section className="ctx-sec">
        <div className="ctx-profile">
          <Avatar conversation={conversation} />
          <div>
            <strong>{name}</strong>
            <span className="hint">{pageName}</span>
          </div>
        </div>
        <dl className="ctx-dl">
          <div>
            <dt>{t('inbox.info.psid')}</dt>
            <dd>
              <code>{conversation.psid}</code>
            </dd>
          </div>
          <div>
            <dt>{t('inbox.info.status')}</dt>
            <dd>
              <StatusBadge status={conversation.status} />
            </dd>
          </div>
          <div>
            <dt>{t('inbox.ctx.firstSeen')}</dt>
            <dd>{ready ? fmt.date(ready.created_at) : '—'}</dd>
          </div>
          <div>
            <dt>{t('inbox.ctx.language')}</dt>
            <dd>{language === 'vi' || language === 'en' ? t(`inbox.ctx.lang.${language}`) : language || '—'}</dd>
          </div>
          <div>
            <dt>{t('inbox.info.page')}</dt>
            <dd>{pageName}</dd>
          </div>
          {conversation.handoff_reason && (
            <div>
              <dt>{t('inbox.info.handoff')}</dt>
              <dd>{reasonText(t, conversation.handoff_reason)}</dd>
            </div>
          )}
        </dl>
      </section>
      {details === 'error' ? (
        <div className="callout callout-danger" role="alert">
          <Icon name="alert" />
          <div className="callout-body">{t('inbox.ctx.loadError')}</div>
          <Button size="sm" icon="rotate" onClick={load}>
            {t('inbox.retry')}
          </Button>
        </div>
      ) : (
        <>
          <section className="ctx-sec">
            <h3>{t('inbox.ctx.stats')}</h3>
            <div className="ctx-stats" aria-busy={!stats}>
              {stats
                ? stats.map(([v, k]) => (
                    <div key={k}>
                      <span className="v">{fmt.number(v)}</span>
                      <span className="k">{k}</span>
                    </div>
                  ))
                : [0, 1, 2, 3].map((i) => <Skeleton key={i} height={44} />)}
            </div>
          </section>
          {ready && <Notes data={data} conversationId={id} initial={ready.notes} />}
        </>
      )}
    </div>
  )
}

function Notes({ data, conversationId, initial }: { data: InboxData; conversationId: string; initial: string }) {
  const { t } = useI18n()
  const fieldId = useId()
  const [value, setValue] = useState(initial)
  const [save, setSave] = useState<Save>('idle')
  // Latest text and what the server has, read by the timer and by the unmount flush.
  const latest = useRef(initial)
  const stored = useRef(initial)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mounted = useRef(true)
  // Saves run one after another, so an older text never lands after a newer one.
  const queue = useRef(Promise.resolve())

  const flush = () => {
    clearTimeout(timer.current)
    const text = latest.current
    if (text === stored.current) return
    if (mounted.current) setSave('saving')
    queue.current = queue.current.then(() => data.saveNotes(conversationId, text)).then(
      () => {
        stored.current = text
        if (mounted.current && latest.current === text) setSave('saved')
      },
      () => {
        if (mounted.current) setSave('error')
      },
    )
  }
  // A pending edit is saved right away when the panel goes away (switching conversation, closing the drawer).
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      flush()
    }
    // Unmount only: flush reads refs, and data and conversation are fixed per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const change = (text: string) => {
    setValue(text)
    latest.current = text
    setSave('idle')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(), NOTES_DEBOUNCE_MS)
  }

  return (
    <section className="ctx-sec">
      <div className="field">
        <label htmlFor={fieldId}>{t('inbox.ctx.notes')}</label>
        <textarea
          id={fieldId}
          className="input textarea"
          rows={4}
          value={value}
          placeholder={t('inbox.ctx.notesPh')}
          aria-describedby={`${fieldId}-hint`}
          onChange={(e) => change(e.target.value)}
          onBlur={flush}
        />
        <p className="hint" id={`${fieldId}-hint`}>
          <Icon name="shield" /> {t('inbox.ctx.notesHint')}
        </p>
        <div className="ctx-save" aria-live="polite">
          {save === 'saving' && <span className="hint">{t('inbox.ctx.saving')}</span>}
          {save === 'saved' && (
            <span className="hint ok">
              <Icon name="check" /> {t('inbox.ctx.saved')}
            </span>
          )}
          {save === 'error' && (
            <span className="ctx-save-err">
              {t('inbox.ctx.saveFailed')}
              <Button size="sm" variant="ghost" icon="rotate" onClick={flush}>
                {t('inbox.ctx.saveRetry')}
              </Button>
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
