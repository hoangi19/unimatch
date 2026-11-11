import { useEffect } from 'react'
import { useI18n, type MessageKey } from './i18n'
import type { LegalPage as Page } from './router'
import { LangSwitch, ThemeButton } from './Shell'
import { useTheme } from './theme'
import { Logo } from './ui/Icon'

// Placeholder until the owner sets a contact address; must be replaced before App Review (docs/app-review.md).
export const CONTACT_EMAIL = '[OWNER CONTACT EMAIL]'

// Paragraphs before a bullet list, the list, then paragraphs after it.
type Section = { title: MessageKey; body?: MessageKey[]; list?: MessageKey[]; after?: MessageKey[] }

const PAGES: Record<Page, { title: MessageKey; intro: MessageKey; sections: Section[] }> = {
  privacy: {
    title: 'legal.privacy.title',
    intro: 'legal.privacy.intro',
    sections: [
      { title: 'legal.privacy.collect.title', body: ['legal.privacy.collect.body'], list: ['legal.privacy.collect.psid', 'legal.privacy.collect.name', 'legal.privacy.collect.messages', 'legal.privacy.collect.events', 'legal.privacy.collect.trace', 'legal.privacy.collect.notes'] },
      { title: 'legal.privacy.use.title', list: ['legal.privacy.use.reply', 'legal.privacy.use.staff', 'legal.privacy.use.stats'], after: ['legal.privacy.use.not'] },
      { title: 'legal.privacy.share.title', body: ['legal.privacy.share.body'], list: ['legal.privacy.share.meta', 'legal.privacy.share.ai', 'legal.privacy.share.supabase', 'legal.privacy.share.cloudflare'] },
      { title: 'legal.privacy.security.title', body: ['legal.privacy.security.body'] },
      { title: 'legal.privacy.retention.title', body: ['legal.privacy.retention.body'] },
      { title: 'legal.privacy.deletion.title', body: ['legal.privacy.deletion.body'] },
      { title: 'legal.privacy.site.title', body: ['legal.privacy.site.body'] },
      { title: 'legal.contact.title', body: ['legal.contact.body'] },
    ],
  },
  'data-deletion': {
    title: 'legal.deletion.title',
    intro: 'legal.deletion.intro',
    sections: [
      { title: 'legal.deletion.what.title', list: ['legal.deletion.what.conversations', 'legal.deletion.what.events', 'legal.deletion.what.pages'] },
      { title: 'legal.deletion.how.title', list: ['legal.deletion.how.page', 'legal.deletion.how.email'] },
      { title: 'legal.deletion.after.title', body: ['legal.deletion.after.body', 'legal.deletion.after.meta'] },
      { title: 'legal.contact.title', body: ['legal.contact.body'] },
    ],
  },
}

/** Public privacy policy and data deletion instructions, shown without a session. */
export function LegalPage({ page }: { page: Page }) {
  const { t } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const { title, intro, sections } = PAGES[page]
  const text = (key: MessageKey) => t(key, { email: CONTACT_EMAIL })

  useEffect(() => {
    document.title = `${t(title)} · UniMatch`
  }, [t, title])

  return (
    <div className="legal">
      <header className="legal-top">
        <a className="brand" href="/privacy">
          <Logo />
          UniMatch
        </a>
        <nav className="legal-nav" aria-label={t('legal.nav')}>
          <a href="/privacy" aria-current={page === 'privacy' ? 'page' : undefined}>
            {t('legal.privacy.title')}
          </a>
          <a href="/data-deletion" aria-current={page === 'data-deletion' ? 'page' : undefined}>
            {t('legal.deletion.title')}
          </a>
        </nav>
        <LangSwitch />
        <ThemeButton theme={theme} onToggle={toggleTheme} />
      </header>
      <main className="legal-main">
        <h1>{t(title)}</h1>
        <p className="legal-updated">{t('legal.updated')}</p>
        <p>{text(intro)}</p>
        {sections.map((s) => (
          <section key={s.title}>
            <h2>{t(s.title)}</h2>
            {s.body?.map((k) => <p key={k}>{text(k)}</p>)}
            {s.list && (
              <ul>
                {s.list.map((k) => (
                  <li key={k}>{text(k)}</li>
                ))}
              </ul>
            )}
            {s.after?.map((k) => <p key={k}>{text(k)}</p>)}
          </section>
        ))}
      </main>
    </div>
  )
}
