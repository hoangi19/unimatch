import { useState } from 'react'
import { useI18n, type MessageKey } from '../i18n'
import { FacebookLoginError } from '../lib/facebook'
import type { PageSummary, PagesErrorKind } from '../lib/pages'
import { Button } from '../ui/controls'
import { Modal } from '../ui/Dialog'
import { Icon } from '../ui/Icon'
import { SUBSCRIBED_FIELDS, type PagesData } from './data'

// Keep in sync with REQUIRED_TASKS in supabase/functions/pages/handler.ts.
const REQUIRED_TASKS = ['MESSAGING', 'MODERATE']
const STEPS: MessageKey[] = ['pages.cn.step1', 'pages.cn.step2', 'pages.cn.step3']

type Props = {
  data: PagesData
  /** Already connected Pages: shown, but not selectable. */
  connectedIds: ReadonlySet<string>
  /** Reconnect: this Page starts selected. */
  preselect?: string
  onConnected: () => void
  onClose: () => void
}

const errKey = (kind: PagesErrorKind | FacebookLoginError['kind']): MessageKey => `pages.err.${kind}`

export function ConnectModal({ data, connectedIds, preselect, onConnected, onClose }: Props) {
  const { t } = useI18n()
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userToken, setUserToken] = useState('')
  const [pages, setPages] = useState<PageSummary[]>([])
  const [selected, setSelected] = useState<string[]>(preselect ? [preselect] : [])
  const [done, setDone] = useState<string[] | null>(null)

  const chosen = pages.filter((p) => selected.includes(p.id))

  const authorize = async () => {
    setBusy(true)
    setError(null)
    try {
      const token = await data.login()
      const res = await data.listPages(token)
      if (!res.ok) return setError(t(errKey(res.error.kind)))
      setUserToken(token)
      setPages(res.pages)
      setSelected((s) => s.filter((id) => res.pages.some((p) => p.id === id)))
      setStep(2)
    } catch (e) {
      setError(t(errKey(e instanceof FacebookLoginError ? e.kind : 'sdk')))
    } finally {
      setBusy(false)
    }
  }

  const review = () => {
    const missing = chosen.filter((p) => !p.tasks.some((task) => REQUIRED_TASKS.includes(task)))
    if (!chosen.length) return setError(t('pages.cn.pickOne'))
    if (missing.length) return setError(t('pages.cn.missingTask', { names: missing.map((p) => p.name).join(', ') }))
    setError(null)
    setStep(3)
  }

  const connect = async () => {
    setBusy(true)
    setError(null)
    const ok: string[] = []
    const failed: { page: PageSummary; kind: PagesErrorKind }[] = []
    // One at a time: each call subscribes the Page and replays its queued webhook events.
    for (const page of chosen) {
      const res = await data.connectPage(userToken, page.id)
      if (res.ok) ok.push(page.name)
      else failed.push({ page, kind: res.error.kind })
    }
    setBusy(false)
    if (ok.length) onConnected()
    if (failed.length) {
      setSelected(failed.map((f) => f.page.id))
      setError(failed.map((f) => t('pages.cn.failed', { name: f.page.name, error: t(errKey(f.kind)) })).join('\n'))
    } else setDone(ok)
  }

  const back = () => {
    setError(null)
    setStep((s) => s - 1)
  }
  const cancel = (
    <Button variant="ghost" onClick={onClose}>
      {t('pages.cancel')}
    </Button>
  )
  const backButton = (
    <Button variant="ghost" className="left" onClick={back} disabled={busy}>
      {t('pages.cn.back')}
    </Button>
  )

  let body
  let footer
  if (done) {
    body = (
      <div className="success-state">
        <div className="success-ring">
          <Icon name="check" />
        </div>
        <h3>{t('pages.cn.doneTitle', { n: done.length })}</h3>
        <p className="muted">{t('pages.cn.doneBody', { names: done.join(', ') })}</p>
      </div>
    )
    footer = (
      <Button variant="cta" onClick={onClose} autoFocus>
        {t('pages.cn.done')}
      </Button>
    )
  } else if (step === 1) {
    body = (
      <div className="fb-auth">
        <span className="icon-tile fb">
          <Icon name="facebook" className="ic ic-xl" />
        </span>
        <p>{t('pages.cn.intro')}</p>
        <Button className="btn-fb" icon="facebook" onClick={() => void authorize()} disabled={busy}>
          {t(busy ? 'pages.cn.loggingIn' : 'pages.cn.login')}
        </Button>
      </div>
    )
    footer = cancel
  } else if (step === 2) {
    body = (
      <fieldset className="field bare">
        <legend className="label">{t('pages.cn.pagesLegend')}</legend>
        <ul className="pick-list">
          {pages.map((page) => {
            const connected = connectedIds.has(page.id)
            return (
              <li key={page.id}>
                <label className={connected ? 'pick is-disabled' : 'pick'}>
                  <input
                    type="checkbox"
                    checked={connected || selected.includes(page.id)}
                    disabled={connected}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, page.id] : s.filter((id) => id !== page.id)))}
                  />
                  <span className="page-avatar" aria-hidden="true">
                    {page.pictureUrl ? <img src={page.pictureUrl} alt="" /> : page.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="pick-main">
                    <strong>{page.name}</strong>
                    <span className="mono">{connected ? t('pages.cn.connected') : t('pages.id', { id: page.id })}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>
    )
    footer = (
      <>
        {backButton}
        {cancel}
        <Button variant="cta" onClick={review}>
          {t('pages.cn.continue')}
        </Button>
      </>
    )
  } else {
    body = (
      <div className="stack">
        <p className="label">{t('pages.cn.reviewLegend', { n: chosen.length })}</p>
        <ul className="chips">
          {chosen.map((p) => (
            <li key={p.id} className="chip">
              {p.name}
            </li>
          ))}
        </ul>
        <p>
          <Icon name="check" /> {t('pages.cn.needTask')}
        </p>
        <p>{t('pages.cn.needFields')}</p>
        <ul className="chips">
          {SUBSCRIBED_FIELDS.map((field) => (
            <li key={field} className="chip mono">
              {field}
            </li>
          ))}
        </ul>
      </div>
    )
    footer = (
      <>
        {backButton}
        {cancel}
        <Button variant="cta" onClick={() => void connect()} disabled={busy}>
          {t(busy ? 'pages.cn.connecting' : 'pages.cn.connectN', { n: chosen.length })}
        </Button>
      </>
    )
  }

  return (
    <Modal open onClose={onClose} title={t('pages.cn.title')} footer={footer}>
      {!done && (
        <ol className="steps" aria-label={t('pages.cn.progress')}>
          {STEPS.map((key, i) => (
            <li key={key} className={i + 1 < step ? 'done' : i + 1 === step ? 'current' : undefined} aria-current={i + 1 === step ? 'step' : undefined}>
              {i + 1}. {t(key)}
            </li>
          ))}
        </ol>
      )}
      {body}
      {error && (
        <div className="callout callout-danger" role="alert">
          <Icon name="alert" />
          <div className="callout-body pre-line">{error}</div>
        </div>
      )}
    </Modal>
  )
}
