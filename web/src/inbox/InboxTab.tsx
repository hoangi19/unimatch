import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { Button, EmptyState, Input, Skeleton } from '../ui/controls'
import { Icon } from '../ui/Icon'
import {
  countByFilter,
  FILTERS,
  matchesSearch,
  shortTime,
  sortConversations,
  upsertConversation,
  type ConversationRow,
  type Filter,
  type InboxData,
  type InboxPage,
} from './data'
import { Composer } from './Composer'
import { CustomerInfo } from './CustomerInfo'
import { InboxStats } from './InboxStats'
import { Avatar, StatusBadge, Thread } from './Thread'
import { useWide } from './useWide'
import './inbox.css'

type Loaded = { pages: InboxPage[]; conversations: ConversationRow[]; now: Date }

export function InboxTab({ data, onConnectPage }: { data: InboxData; onConnectPage?: () => void }) {
  const { t, lang } = useI18n()
  const [loaded, setLoaded] = useState<Loaded | null | 'error'>(null)
  const [query, setQuery] = useState('')
  const [pageId, setPageId] = useState('all')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const pageSelectId = useId()
  const wide = useWide()

  const load = useCallback(() => {
    Promise.all([data.loadPages(), data.loadConversations()]).then(
      ([pages, conversations]) => setLoaded({ pages, conversations, now: new Date() }),
      () => setLoaded('error'),
    )
  }, [data])

  useEffect(load, [load])

  useEffect(
    () =>
      data.subscribe((event) => {
        const apply = (update: (rows: ConversationRow[]) => ConversationRow[]) =>
          setLoaded((l) => (l && l !== 'error' ? { ...l, conversations: update(l.conversations), now: new Date() } : l))
        if (event.type === 'conversation') apply((rows) => upsertConversation(rows, event.row))
        if (event.type === 'conversationDeleted') apply((rows) => rows.filter((r) => r.id !== event.id))
        // Quiet refetch: the list stays on screen; a failure keeps the rows already shown.
        if (event.type === 'resync') data.loadConversations().then((rows) => apply(() => rows), () => {})
      }),
    [data],
  )

  const open = loaded && loaded !== 'error' ? loaded.conversations.find((c) => c.id === selectedId) : undefined
  const openUnread = open ? open.unread_count : 0

  // Mark as read while the conversation is open and the browser tab is visible; Realtime carries it to other tabs.
  useEffect(() => {
    if (!selectedId || !openUnread) return
    const markRead = () => {
      if (document.visibilityState !== 'visible') return
      setLoaded((l) => (l && l !== 'error' ? { ...l, conversations: l.conversations.map((c) => (c.id === selectedId ? { ...c, unread_count: 0 } : c)) } : l))
      // A failed write is left alone: the next live row shows the real count.
      data.markRead(selectedId).catch(() => {})
    }
    markRead()
    document.addEventListener('visibilitychange', markRead)
    return () => document.removeEventListener('visibilitychange', markRead)
  }, [data, selectedId, openUnread])

  if (loaded === 'error') {
    return (
      <div className="callout callout-danger" role="alert">
        <Icon name="alert" />
        <div className="callout-body">{t('inbox.loadError')}</div>
        <Button
          size="sm"
          icon="rotate"
          onClick={() => {
            setLoaded(null)
            load()
          }}
        >
          {t('inbox.retry')}
        </Button>
      </div>
    )
  }
  if (loaded && !loaded.pages.length && !loaded.conversations.length) {
    return (
      <>
        <EmptyState icon="inbox" title={t('inbox.noPagesTitle')}>
          {t('inbox.noPagesBody')}
        </EmptyState>
        {onConnectPage && (
          <div className="empty-cta">
            <Button variant="cta" icon="plus" onClick={onConnectPage}>
              {t('inbox.connectPage')}
            </Button>
          </div>
        )}
      </>
    )
  }

  const pages = loaded ? loaded.pages : []
  const all = loaded ? loaded.conversations : []
  const pageName = (id: string) => pages.find((p) => p.id === id)?.name ?? id
  const searched = all.filter((c) => (pageId === 'all' || c.page_id === pageId) && matchesSearch(c, query))
  const counts = countByFilter(searched)
  const shown = sortConversations(filter === 'all' ? searched : searched.filter((c) => c.status === filter))
  const selected = all.find((c) => c.id === selectedId) ?? null
  const now = loaded ? loaded.now : undefined

  const back = () => {
    setSelectedId(null)
    // Return focus to the row the admin came from.
    requestAnimationFrame(() => document.getElementById(`conv-${selectedId}`)?.focus())
  }

  let none = null
  if (!all.length) none = <ListNote icon="inbox" title={t('inbox.emptyTitle')} body={t('inbox.emptyBody')} />
  else if (query.trim() && !searched.length)
    none = (
      <ListNote icon="search" title={t('inbox.noResults', { q: query.trim() })} body={t('inbox.noResultsBody')}>
        <Button size="sm" onClick={() => setQuery('')}>
          {t('inbox.clearSearch')}
        </Button>
      </ListNote>
    )
  else if (!shown.length) none = <ListNote icon="inbox" title={t('inbox.noneFilter')} body={t('inbox.noneFilterBody')} />

  return (
    <div className="inbox">
      <InboxStats data={data} pageId={pageId === 'all' ? undefined : pageId} />
      <div className="ib-grid" data-pane={selected ? 'thread' : 'list'}>
        <section className="ib-list" aria-label={t('inbox.list')}>
          <div className="ib-list-head">
            <Input label={t('inbox.search')} type="search" placeholder={t('inbox.searchPh')} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            <div className="field">
              <label htmlFor={pageSelectId}>{t('inbox.pageFilter')}</label>
              <select id={pageSelectId} className="input ib-select" value={pageId} onChange={(e) => setPageId(e.target.value)}>
                <option value="all">{t('inbox.allPages')}</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="ib-filters" role="group" aria-label={t('inbox.filters')}>
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={f === 'needs_human' && counts[f] ? 'ib-filter has-needs' : 'ib-filter'}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {t(f === 'all' ? 'inbox.filter.all' : `inbox.status.${f}`)}
                <span className="n">{loaded ? counts[f] : '–'}</span>
              </button>
            ))}
          </div>
          <ul className="conv-list" aria-busy={!loaded}>
            {!loaded
              ? [0, 1, 2, 3].map((i) => <ConversationSkeleton key={i} />)
              : (none ?? shown.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      id={`conv-${c.id}`}
                      className={c.status === 'needs_human' ? 'conv is-needs' : 'conv'}
                      aria-current={c.id === selectedId || undefined}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <Avatar conversation={c} />
                      <span className="conv-main">
                        <span className="conv-top">
                          <strong>{c.customer_name ?? t('inbox.noName')}</strong>
                          {c.last_message_at && <time dateTime={c.last_message_at}>{shortTime(c.last_message_at, lang, now)}</time>}
                        </span>
                        <span className={c.unread_count ? 'conv-snip is-unread' : 'conv-snip'}>{c.last_message_preview ?? ''}</span>
                        <span className="conv-tags">
                          <StatusBadge status={c.status} />
                          <span className="badge conv-page">{pageName(c.page_id)}</span>
                          {c.unread_count > 0 && (
                            <span className="unread" role="img" aria-label={t('inbox.unread', { n: c.unread_count })} title={t('inbox.unread', { n: c.unread_count })} />
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                )))}
          </ul>
        </section>
        <section className="ib-thread" aria-label={t('inbox.threadPane')}>
          {selected ? (
            <Thread
              key={selected.id}
              data={data}
              conversation={selected}
              pageName={pageName(selected.page_id)}
              onBack={back}
              onChange={(row) => setLoaded((l) => (l && l !== 'error' ? { ...l, conversations: upsertConversation(l.conversations, row) } : l))}
              footer={(reply) => <Composer data={data} conversation={selected} {...reply} />}
            />
          ) : (
            <div className="ib-placeholder">
              <Icon name="inbox" className="ic ic-xl" />
              <h3>{t('inbox.pick')}</h3>
              <p>{t('inbox.pickBody')}</p>
            </div>
          )}
        </section>
        {wide && selected && (
          <aside className="ib-ctx" aria-label={t('inbox.ctx.title')}>
            <CustomerInfo key={selected.id} data={data} conversation={selected} name={selected.customer_name ?? t('inbox.noName')} pageName={pageName(selected.page_id)} />
          </aside>
        )}
      </div>
    </div>
  )
}

function ListNote({ icon, title, body, children }: { icon: 'inbox' | 'search'; title: string; body: string; children?: ReactNode }) {
  return (
    <li className="ib-none">
      <Icon name={icon} />
      <strong>{title}</strong>
      <span>{body}</span>
      {children}
    </li>
  )
}

function ConversationSkeleton() {
  return (
    <li className="conv conv-skel" aria-hidden="true">
      <span className="p-av skeleton" />
      <span className="conv-main">
        <Skeleton width="60%" />
        <Skeleton width="85%" />
      </span>
    </li>
  )
}
