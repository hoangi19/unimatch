import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { signInError, type AuthClient, type SignInError } from './auth'
import { useI18n, type MessageKey } from './i18n'
import { LangSwitch, ThemeButton } from './Shell'
import { useTheme } from './theme'
import { Button, EmptyState, Input } from './ui/controls'
import { Icon, Logo } from './ui/Icon'

// Only the email is remembered; the session itself always persists (supabase-js).
export const EMAIL_KEY = 'um-email'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function storedEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberEmail(email: string | null) {
  try {
    if (email) localStorage.setItem(EMAIL_KEY, email)
    else localStorage.removeItem(EMAIL_KEY)
  } catch {
    // Storage blocked: nothing to remember.
  }
}

function emailError(email: string): MessageKey | undefined {
  if (!email) return 'login.emailRequired'
  return EMAIL_RE.test(email) ? undefined : 'login.emailInvalid'
}

export function Login({ auth }: { auth: AuthClient }) {
  const { t } = useI18n()
  const title = t('login.title')
  const [email, setEmail] = useState(storedEmail)
  const [remember, setRemember] = useState(() => storedEmail() !== '')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [errors, setErrors] = useState<{ email?: MessageKey; password?: MessageKey }>({})
  const [failure, setFailure] = useState<SignInError | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = `${title} · UniMatch`
  }, [title])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const address = email.trim()
    const next = { email: emailError(address), password: password ? undefined : ('login.passwordRequired' as const) }
    setErrors(next)
    setFailure(null)
    if (next.email || next.password) return
    rememberEmail(remember ? address : null)
    setBusy(true)
    const { error } = await auth.signInWithPassword({ email: address, password })
    // On success the auth listener swaps this screen out, so only failures need handling here.
    if (error) {
      setFailure(signInError(error))
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <aside className="login-aside" aria-hidden="true">
        <div className="brand">
          <Logo />
          UniMatch <small>{t('brand.admin')}</small>
        </div>
        <div>
          <h2>
            {t('login.asideTitle')} <em>{t('login.asideAccent')}</em>
          </h2>
          <p className="lede">{t('login.lede')}</p>
        </div>
      </aside>
      <AuthMain>
        <div className="brand login-brand">
          <Logo />
          UniMatch
        </div>
        <h1>{title}</h1>
        <p className="sub">{t('login.sub')}</p>
        <form className="login-form" noValidate onSubmit={submit}>
          {failure && (
            <div className="form-alert" role="alert">
              <Icon name="alert" />
              <div>{t(`login.error.${failure}`)}</div>
            </div>
          )}
          <Input
            label={t('login.email')}
            type="email"
            name="email"
            autoComplete="username"
            placeholder={t('login.emailPh')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email && t(errors.email)}
          />
          <Input
            label={t('login.password')}
            type={showPw ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            placeholder={t('login.passwordPh')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password && t(errors.password)}
            end={
              <Button
                variant="ghost"
                size="sm"
                icon={showPw ? 'eye-off' : 'eye'}
                label={t(showPw ? 'login.hidePw' : 'login.showPw')}
                aria-pressed={showPw}
                onClick={() => setShowPw(!showPw)}
              />
            }
          />
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t('login.remember')}
          </label>
          <Button type="submit" variant="cta" className="btn-block" aria-busy={busy} disabled={busy}>
            {busy && <Spinner />}
            {t(busy ? 'login.submitting' : 'login.submit')}
          </Button>
        </form>
      </AuthMain>
    </div>
  )
}

/** Shown to a signed-in user without the admin role. */
export function NoAccess({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const { t } = useI18n()
  const title = t('noAccess.title')
  useEffect(() => {
    document.title = `${title} · UniMatch`
  }, [title])
  return (
    <div className="no-access">
      <AuthMain>
        <EmptyState icon="alert" title={title}>
          {t('noAccess.body', { email })}
        </EmptyState>
        <Button variant="secondary" icon="logout" className="btn-block" onClick={onSignOut}>
          {t('user.signOut')}
        </Button>
      </AuthMain>
    </div>
  )
}

function AuthMain({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme()
  return (
    <main className="login-main">
      <div className="login-top">
        <LangSwitch />
        <ThemeButton theme={theme} onToggle={toggleTheme} />
      </div>
      <div className="login-card">{children}</div>
    </main>
  )
}

function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
