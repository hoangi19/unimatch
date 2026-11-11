import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useI18n, type MessageKey } from '../i18n'
import { Button, EmptyState, Input, Skeleton, Toggle } from '../ui/controls'
import { Modal } from '../ui/Dialog'
import { Icon } from '../ui/Icon'
import { TOAST_MS, useToast } from '../ui/toast-context'
import { ConnectModal } from './ConnectModal'
import { pageStatus, SUBSCRIBED_FIELDS, type PageRow, type PagesData, type PageStatus } from './data'
import { DAYS, MAX_DELAY_S, sameForm, toForm, toRow, validate, type ReplyErrors, type ReplyForm } from './replySettings'
import './pages.css'

const EXPIRY_WARN_DAYS = 7

const fieldId = (pageId: string, field: string) => `ps-${pageId}-${field}`

export function PagesTab({ data }: { data: PagesData }) {
  const { t } = useI18n()
  const toast = useToast()
  const [rows, setRows] = useState<PageRow[] | null | 'error'>(null)
  const [now, setNow] = useState(() => Date.now())
  const [drafts, setDrafts] = useState<Record<string, ReplyForm>>({})
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [connect, setConnect] = useState<{ key: number; preselect?: string } | null>(null)
  const [confirm, setConfirm] = useState<PageRow | null>(null)
  const [disconnecting, setDisconnecting] = useState<ReadonlySet<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const load = useCallback(() => {
    data.loadRows().then(
      (r) => {
        setNow(Date.now())
        setRows(r)
      },
      () => setRows('error'),
    )
  }, [data])

  useEffect(() => {
    load()
    // Load the SDK early so the login popup opens straight from the click and is not blocked.
    data.loadSdk().catch(() => undefined)
  }, [data, load])

  // Leaving the tab while an undo window is open disconnects at once, so the admin's choice is not lost.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer, id) => {
        clearTimeout(timer)
        void data.disconnectPage(id)
      })
      pending.clear()
    }
  }, [data])

  const list = Array.isArray(rows) ? rows : []
  const formOf = (row: PageRow) => drafts[row.id] ?? toForm(row)
  const dirty = list.filter((row) => drafts[row.id] && !sameForm(drafts[row.id], toForm(row)))

  const setForm = (row: PageRow, patch: Partial<ReplyForm>) => setDrafts((d) => ({ ...d, [row.id]: { ...formOf(row), ...patch } }))

  const toggleBot = async (row: PageRow, on: boolean) => {
    const set = (value: boolean) => setRows((r) => (Array.isArray(r) ? r.map((x) => (x.id === row.id ? { ...x, bot_enabled: value } : x)) : r))
    set(on)
    try {
      await data.updatePage(row.id, { bot_enabled: on })
      toast({ kind: 'success', title: t(on ? 'pages.botOn' : 'pages.botOff', { name: row.name }) })
    } catch {
      set(!on)
      toast({ kind: 'error', title: t('pages.botFailed', { name: row.name }) })
    }
  }

  const save = async () => {
    const invalid = dirty.map((row) => [row, validate(drafts[row.id])] as const).filter(([, e]) => Object.keys(e).length)
    if (invalid.length) {
      const [row, errors] = invalid[0]
      // Render the opened settings first, so the first invalid field exists to focus.
      flushSync(() => {
        setShowErrors(true)
        setOpen((o) => new Set([...o, ...invalid.map(([r]) => r.id)]))
      })
      // Fields appear in this order on the card: end time, then the days.
      document.getElementById(errors.end ? fieldId(row.id, 'end') : fieldId(row.id, DAYS[0]))?.focus()
      toast({ kind: 'error', title: t('pages.save.invalid') })
      return
    }
    setSaving(true)
    const results = await Promise.allSettled(dirty.map((row) => data.updatePage(row.id, toRow(drafts[row.id]))))
    setSaving(false)
    const saved = new Set(dirty.filter((_, i) => results[i].status === 'fulfilled').map((row) => row.id))
    setRows((r) => (Array.isArray(r) ? r.map((x) => (saved.has(x.id) ? { ...x, ...toRow(drafts[x.id]) } : x)) : r))
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !saved.has(id))))
    const failed = dirty.filter((row) => !saved.has(row.id))
    failed.forEach((row) => toast({ kind: 'error', title: t('pages.save.failed', { name: row.name }) }))
    if (!failed.length) {
      setShowErrors(false)
      toast({ kind: 'success', title: t('pages.save.saved') })
    }
  }

  const discard = () => {
    setDrafts({})
    setShowErrors(false)
  }

  const markDisconnecting = (id: string, on: boolean) =>
    setDisconnecting((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  // A real disconnect cannot be undone, so the call waits out the undo window.
  const disconnect = (row: PageRow) => {
    setConfirm(null)
    markDisconnecting(row.id, true)
    const run = async () => {
      timers.current.delete(row.id)
      const res = await data.disconnectPage(row.id)
      markDisconnecting(row.id, false)
      if (res.ok) {
        toast({ kind: 'success', title: t('pages.dc.done', { name: row.name }) })
        load()
      } else {
        toast({ kind: 'error', title: t('pages.dc.failed', { name: row.name }), body: t(`pages.err.${res.error.kind}`) })
      }
    }
    timers.current.set(row.id, setTimeout(run, TOAST_MS))
    const undo = () => {
      clearTimeout(timers.current.get(row.id))
      timers.current.delete(row.id)
      markDisconnecting(row.id, false)
    }
    toast({ title: t('pages.dc.toast', { name: row.name }), body: t('pages.dc.toastBody'), action: { label: t('pages.dc.undo'), onClick: undo } })
  }

  const openConnect = (preselect?: string) => setConnect({ key: Date.now(), preselect })
  const connectButton = (
    <Button variant="cta" icon="plus" onClick={() => openConnect()}>
      {t('pages.connect')}
    </Button>
  )

  let body
  if (rows === null) {
    body = (
      <div className="page-list" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="card page-row">
            <Skeleton width={44} height={44} />
            <Skeleton width="40%" height={14} />
          </div>
        ))}
      </div>
    )
  } else if (rows === 'error') {
    body = (
      <div className="callout callout-danger" role="alert">
        <Icon name="alert" />
        <div className="callout-body">{t('pages.loadError')}</div>
        <Button size="sm" icon="rotate" onClick={load}>
          {t('pages.retry')}
        </Button>
      </div>
    )
  } else if (!rows.length) {
    body = (
      <div className="card">
        <EmptyState icon="facebook" title={t('pages.emptyTitle')}>
          {t('pages.emptyBody')}
        </EmptyState>
        <div className="empty-cta">{connectButton}</div>
      </div>
    )
  } else {
    body = (
      <ul className="page-list" aria-label={t('pages.listAria')}>
        {rows.map((row) => (
          <li key={row.id}>
            <PageCard
              row={row}
              status={pageStatus(row, now)}
              form={formOf(row)}
              errors={showErrors ? validate(formOf(row)) : {}}
              settingsOpen={open.has(row.id)}
              disconnecting={disconnecting.has(row.id)}
              onToggleSettings={() =>
                setOpen((o) => {
                  const next = new Set(o)
                  if (!next.delete(row.id)) next.add(row.id)
                  return next
                })
              }
              onBot={(on) => void toggleBot(row, on)}
              onForm={(patch) => setForm(row, patch)}
              onReconnect={() => openConnect(row.id)}
              onDisconnect={() => setConfirm(row)}
            />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <div className="view-head">
        <div>
          <h2>{t('tab.pages')}</h2>
          <p className="sub">{t('pages.sub')}</p>
        </div>
        {Array.isArray(rows) && rows.length > 0 && connectButton}
      </div>
      <div className="pages-layout">
        {body}
        <WebhookCard url={data.webhookUrl} />
      </div>

      <section className={dirty.length ? 'savebar show' : 'savebar'} aria-label={t('pages.save.region')} inert={!dirty.length}>
        <span className="msg-txt">
          <Icon name="alert" />
          {t('pages.save.msg', { n: dirty.length })}
        </span>
        <Button variant="ghost" onClick={discard} disabled={saving}>
          {t('pages.save.discard')}
        </Button>
        <Button variant="cta" onClick={() => void save()} disabled={saving}>
          {t(saving ? 'pages.save.saving' : 'pages.save.save')}
        </Button>
      </section>

      {confirm && (
        <Modal
          open
          onClose={() => setConfirm(null)}
          title={t('pages.dc.title', { name: confirm.name })}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {t('pages.cancel')}
              </Button>
              <Button variant="danger" icon="unlink" onClick={() => disconnect(confirm)}>
                {t('pages.dc.confirm')}
              </Button>
            </>
          }
        >
          <p>{t('pages.dc.body')}</p>
        </Modal>
      )}

      {connect && (
        <ConnectModal
          key={connect.key}
          data={data}
          preselect={connect.preselect}
          connectedIds={new Set(list.filter((r) => r.access_token_secret_id && r.id !== connect.preselect).map((r) => r.id))}
          onConnected={load}
          onClose={() => setConnect(null)}
        />
      )}
    </>
  )
}

type CardProps = {
  row: PageRow
  status: PageStatus
  form: ReplyForm
  errors: ReplyErrors
  settingsOpen: boolean
  disconnecting: boolean
  onToggleSettings: () => void
  onBot: (on: boolean) => void
  onForm: (patch: Partial<ReplyForm>) => void
  onReconnect: () => void
  onDisconnect: () => void
}

function PageCard({ row, status, form, errors, settingsOpen, disconnecting, onToggleSettings, onBot, onForm, onReconnect, onDisconnect }: CardProps) {
  const { t, fmt } = useI18n()
  const nameId = `pg-${row.id}-name`
  const settingsId = `ps-${row.id}`
  const shown: PageStatus['kind'] | 'disconnecting' = disconnecting ? 'disconnecting' : status.kind
  const badge = { ok: 'b-success', disconnected: '', expired: 'b-danger', disconnecting: 'b-warning' }[shown]
  const expiring = status.kind === 'ok' && status.daysLeft !== null && status.daysLeft <= EXPIRY_WARN_DAYS

  return (
    <article className="card page-card" aria-labelledby={nameId}>
      <div className="page-row">
        <span className="page-avatar" aria-hidden="true">
          {row.picture_url ? <img src={row.picture_url} alt="" /> : row.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="page-meta">
          <h3 id={nameId}>{row.name}</h3>
          <div className="sub">
            <span className="mono">{t('pages.id', { id: row.id })}</span>
          </div>
        </div>
        <div className="page-right">
          <span className={`badge ${badge}`}>
            <Icon name={shown === 'ok' ? 'check' : 'alert'} />
            {t(`pages.status.${shown}`)}
          </span>
          <Toggle label={t('pages.autoReply')} checked={row.bot_enabled} onChange={onBot} />
        </div>
      </div>

      {(status.kind !== 'ok' || expiring) && !disconnecting && (
        <div className="page-callouts">
          {status.kind === 'expired' && (
            <div className="callout callout-danger">
              <Icon name="alert" />
              <div className="callout-body">
                <strong>{t('pages.expiredTitle')}</strong> {t('pages.expiredBody')}
              </div>
            </div>
          )}
          {status.kind === 'disconnected' && (
            <div className="callout callout-info">
              <Icon name="info" />
              <div className="callout-body">{t('pages.disconnectedBody')}</div>
            </div>
          )}
          {expiring && (
            <div className="callout callout-warning">
              <Icon name="clock" />
              <div className="callout-body">
                <strong>{t('pages.expiringTitle', { when: fmt.relative(status.daysLeft!, 'day') })}</strong> {t('pages.expiringBody')}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="page-actions">
        <Button variant="ghost" size="sm" icon="clock" aria-expanded={settingsOpen} aria-controls={settingsId} onClick={onToggleSettings}>
          {t('pages.settings')}
          <Icon name="chevron-down" className="ic chev" />
        </Button>
        <span className="spacer" />
        <Button variant="ghost" size="sm" icon="rotate" aria-label={t('pages.reconnectAria', { name: row.name })} onClick={onReconnect}>
          <span className="hide-sm">{t('pages.reconnect')}</span>
        </Button>
        {status.kind !== 'disconnected' && (
          <Button
            variant="ghost"
            size="sm"
            icon="unlink"
            className="btn-ghost-danger"
            aria-label={t('pages.disconnectAria', { name: row.name })}
            disabled={disconnecting}
            onClick={onDisconnect}
          >
            <span className="hide-sm">{t('pages.disconnect')}</span>
          </Button>
        )}
      </div>

      {settingsOpen && <ReplySettings pageId={row.id} form={form} errors={errors} onForm={onForm} />}
    </article>
  )
}

function ReplySettings({ pageId, form, errors, onForm }: { pageId: string; form: ReplyForm; errors: ReplyErrors; onForm: (patch: Partial<ReplyForm>) => void }) {
  const { t, fmt } = useI18n()
  const dayNames = t('pages.ps.dayNames').split(',')
  const daysErrId = `${fieldId(pageId, 'days')}-err`
  const err = (key?: MessageKey) => (key ? t(key) : undefined)

  return (
    <div className="page-settings" id={`ps-${pageId}`}>
      <fieldset className="field bare">
        <legend className="label">{t('pages.ps.availability')}</legend>
        <div className="segmented">
          {(['always', 'hours'] as const).map((mode) => (
            <label key={mode}>
              <input type="radio" name={`${pageId}-mode`} value={mode} checked={form.mode === mode} onChange={() => onForm({ mode })} />
              <span>{t(mode === 'always' ? 'pages.ps.always' : 'pages.ps.hours')}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {form.mode === 'hours' && (
        <>
          <div className="grid-2">
            <Input label={t('pages.ps.start')} type="time" id={fieldId(pageId, 'start')} value={form.start} onChange={(e) => onForm({ start: e.target.value })} />
            <Input
              label={t('pages.ps.end')}
              type="time"
              id={fieldId(pageId, 'end')}
              value={form.end}
              hint={t('pages.ps.tzHint')}
              error={err(errors.end)}
              onChange={(e) => onForm({ end: e.target.value })}
            />
          </div>
          <fieldset className="field bare" aria-describedby={errors.days ? daysErrId : undefined}>
            <legend className="label">{t('pages.ps.days')}</legend>
            <div className="days">
              {DAYS.map((day, i) => (
                <label key={day} className="day">
                  <input
                    type="checkbox"
                    id={fieldId(pageId, day)}
                    checked={form.days.includes(day)}
                    aria-invalid={errors.days ? true : undefined}
                    onChange={(e) => onForm({ days: DAYS.filter((d) => (d === day ? e.target.checked : form.days.includes(d))) })}
                  />
                  <span>{dayNames[i]}</span>
                </label>
              ))}
            </div>
            {errors.days && (
              <p className="err" id={daysErrId}>
                <Icon name="alert" />
                {t(errors.days)}
              </p>
            )}
          </fieldset>
        </>
      )}

      <div className="grid-2">
        <Input
          label={t('pages.ps.keywords')}
          id={fieldId(pageId, 'keywords')}
          value={form.keywords}
          hint={t('pages.ps.keywordsHint')}
          onChange={(e) => onForm({ keywords: e.target.value })}
        />
        <div className="field">
          <label htmlFor={fieldId(pageId, 'delay')}>{t('pages.ps.delay')}</label>
          <div className="range-row">
            <input
              id={fieldId(pageId, 'delay')}
              type="range"
              min={0}
              max={MAX_DELAY_S}
              step={1}
              value={form.delayS}
              aria-describedby={`${fieldId(pageId, 'delay')}-hint`}
              onChange={(e) => onForm({ delayS: Number(e.target.value) })}
            />
            <output htmlFor={fieldId(pageId, 'delay')}>{fmt.duration(form.delayS)}</output>
          </div>
          <div className="range-scale" aria-hidden="true">
            <span>{t('pages.ps.instant')}</span>
            <span>{t('pages.ps.delayMax')}</span>
          </div>
          <p className="hint" id={`${fieldId(pageId, 'delay')}-hint`}>
            {t('pages.ps.delayHint')}
          </p>
        </div>
      </div>
    </div>
  )
}

function WebhookCard({ url }: { url: string }) {
  const { t } = useI18n()
  const toast = useToast()
  const copy = async () => {
    // Clipboard can be blocked; the field stays selectable either way.
    await navigator.clipboard?.writeText(url).catch(() => undefined)
    toast({ kind: 'success', title: t('pages.wh.copied') })
  }
  return (
    <section className="card" aria-labelledby="wh-title">
      <div className="card-head">
        <div>
          <h3 id="wh-title">
            <Icon name="webhook" />
            {t('pages.wh.title')}
          </h3>
          <p>{t('pages.wh.sub')}</p>
        </div>
      </div>
      <div className="card-body">
        <div className="field">
          <label htmlFor="wh-url">{t('pages.wh.url')}</label>
          <div className="input-group">
            <input id="wh-url" className="input mono" readOnly value={url} onFocus={(e) => e.target.select()} />
            <Button icon="copy" label={t('pages.wh.copyUrl')} onClick={() => void copy()} />
          </div>
        </div>
        <div className="field">
          <span className="label">{t('pages.wh.token')}</span>
          <span className="badge b-success">
            <Icon name="check" />
            {t('pages.wh.tokenSet')}
          </span>
          <p className="hint">{t('pages.wh.tokenHint')}</p>
        </div>
        <div className="field">
          <span className="label">{t('pages.wh.fields')}</span>
          <ul className="chips">
            {SUBSCRIBED_FIELDS.map((field) => (
              <li key={field} className="chip mono">
                <Icon name="check" />
                {field}
              </li>
            ))}
          </ul>
          <p className="hint">{t('pages.wh.fieldsHint')}</p>
        </div>
      </div>
    </section>
  )
}
