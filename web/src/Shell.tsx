import { useEffect, useRef, useState } from 'react'
import { LANGS, useI18n, type MessageKey } from './i18n'
import { TABS, useTab, type Tab } from './router'
import { useTheme, type Theme } from './theme'
import { Button, EmptyState } from './ui/controls'
import { Icon, Logo, type IconName } from './ui/Icon'

export type SystemStatus = { webhook?: string; ai?: string; botOn?: boolean }

const TAB_ICONS: Record<Tab, IconName> = { inbox: 'inbox', pages: 'facebook', dataset: 'database', chatbot: 'bot' }
// The Dataset tab is out of product scope for now: shown, but disabled.
const DISABLED: ReadonlySet<Tab> = new Set(['dataset'])

type ShellProps = { status?: SystemStatus; onSignOut?: () => void }

export function Shell({ status = {}, onSignOut }: ShellProps) {
  const { t } = useI18n()
  const { tab, navigate } = useTab()
  const [navOpen, setNavOpen] = useState(false)
  const closeNav = useRef<HTMLButtonElement>(null)
  const title = t(`tab.${tab}`)

  useEffect(() => {
    document.title = `${title} · UniMatch`
  }, [title])

  useEffect(() => {
    if (!navOpen) return
    // Mobile drawer: move keyboard focus into it; the button is hidden on desktop.
    closeNav.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false)
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [navOpen])

  const go = (next: Tab) => {
    navigate(next)
    setNavOpen(false)
  }

  return (
    <div className={navOpen ? 'app nav-open' : 'app'}>
      <aside className="sidebar" id="sidebar">
        <div className="brand">
          <Logo />
          UniMatch <small>{t('brand.admin')}</small>
          <Button ref={closeNav} variant="ghost" icon="x" label={t('nav.close')} className="close-nav" onClick={() => setNavOpen(false)} />
        </div>
        <nav aria-label={t('nav.aria')}>
          <div className="nav-label" aria-hidden="true">
            {t('nav.label')}
          </div>
          <ul className="nav">
            {TABS.map((item) => (
              <li key={item}>
                <NavItem tab={item} current={item === tab} onGo={go} />
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <Topbar tab={tab} title={title} onOpenNav={() => setNavOpen(true)} navOpen={navOpen} onSignOut={onSignOut} />
        <StatusBar status={status} />
        <main className="view">
          <TabPlaceholder tab={tab} />
        </main>
      </div>
    </div>
  )
}

function NavItem({ tab, current, onGo }: { tab: Tab; current: boolean; onGo: (tab: Tab) => void }) {
  const { t } = useI18n()
  const disabled = DISABLED.has(tab)
  return (
    <a
      href={`/${tab}`}
      className="nav-btn"
      aria-current={current ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        e.preventDefault()
        if (!disabled) onGo(tab)
      }}
    >
      <Icon name={TAB_ICONS[tab]} />
      {t(`tab.${tab}`)}
      {disabled && <span className="count">{t('nav.soon')}</span>}
    </a>
  )
}

type TopbarProps = { tab: Tab; title: string; navOpen: boolean; onOpenNav: () => void; onSignOut?: () => void }

function Topbar({ tab, title, navOpen, onOpenNav, onSignOut }: TopbarProps) {
  const { t } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const heading = useRef<HTMLHeadingElement>(null)
  const shownTab = useRef(tab)

  // Move focus to the new page title so screen readers announce the tab change.
  useEffect(() => {
    if (tab !== shownTab.current) heading.current?.focus()
    shownTab.current = tab
  }, [tab])

  return (
    <header className="topbar">
      <Button
        variant="ghost"
        icon="menu"
        label={t('nav.open')}
        className="menu-btn"
        aria-controls="sidebar"
        aria-expanded={navOpen}
        onClick={onOpenNav}
      />
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      <span className="spacer" />
      <LangSwitch />
      <ThemeButton theme={theme} onToggle={toggleTheme} />
      <button type="button" className="user-btn" popoverTarget="user-menu" aria-haspopup="menu" aria-label={t('user.menu')}>
        <span className="avatar">AD</span>
        <Icon name="chevron-down" />
      </button>
      <div id="user-menu" className="menu" popover="auto">
        <div className="menu-panel" role="menu" aria-label={t('user.menu')}>
          <div className="menu-head">
            <strong>Admin</strong>
          </div>
          <button type="button" className="menu-item" role="menuitem" onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            {t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark')}
          </button>
          {onSignOut && (
            <button type="button" className="menu-item danger" role="menuitem" onClick={onSignOut}>
              <Icon name="logout" />
              {t('user.signOut')}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

export function LangSwitch() {
  const { t, lang, setLang } = useI18n()
  return (
    <div className="lang-switch" role="group" aria-label={t('lang.group')}>
      {LANGS.map((code) => (
        <button key={code} type="button" className="lang-btn" lang={code} aria-pressed={lang === code} onClick={() => setLang(code)}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

// Takes the theme from its caller: the topbar menu toggles the same theme state.
export function ThemeButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const { t } = useI18n()
  return (
    <Button
      variant="ghost"
      icon={theme === 'dark' ? 'sun' : 'moon'}
      label={t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark')}
      onClick={onToggle}
    />
  )
}

function StatusBar({ status }: { status: SystemStatus }) {
  const { t } = useI18n()
  const unknown = t('status.unknown')
  const bot = status.botOn === undefined ? unknown : t(status.botOn ? 'status.on' : 'status.paused')
  const items: [IconName, MessageKey, string, boolean][] = [
    ['webhook', 'status.webhook', status.webhook ?? unknown, status.webhook !== undefined],
    ['sparkles', 'status.ai', status.ai ?? unknown, status.ai !== undefined],
    ['bot', 'status.bot', bot, status.botOn === true],
  ]
  return (
    <section className="status-strip" aria-label={t('status.aria')}>
      {items.map(([icon, key, value, live]) => (
        <span key={key} className="status-item">
          <span className={live ? 'pulse' : 'pulse off'} aria-hidden="true" />
          <Icon name={icon} />
          <span className="k">{t(key)}</span>
          <span className="v">{value}</span>
        </span>
      ))}
    </section>
  )
}

function TabPlaceholder({ tab }: { tab: Tab }) {
  const { t } = useI18n()
  const soon = DISABLED.has(tab)
  return (
    <EmptyState icon={TAB_ICONS[tab]} title={t(soon ? 'empty.soonTitle' : 'empty.title')}>
      {t(`empty.${tab}`)}
    </EmptyState>
  )
}
