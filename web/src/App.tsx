import { authState, useSession, type AuthClient } from './auth'
import type { ChatbotApi } from './chatbot/api'
import { I18nProvider } from './i18n'
import type { InboxData } from './inbox/data'
import { LegalPage } from './Legal'
import { Login, NoAccess } from './Login'
import type { PagesData } from './pages/data'
import { legalFromPath } from './router'
import { Shell, type SystemStatus } from './Shell'
import { ToastProvider } from './ui/ToastProvider'

type AppProps = { auth: AuthClient; status?: SystemStatus; inboxData?: InboxData; pagesData?: PagesData; chatbot?: ChatbotApi }

// Status values arrive with later screens.
export default function App(props: AppProps) {
  const legal = legalFromPath(location.pathname)
  return (
    <I18nProvider>
      <ToastProvider>{legal ? <LegalPage page={legal} /> : <Gate {...props} />}</ToastProvider>
    </I18nProvider>
  )
}

/** Route guard: every path needs an admin session. The URL is left alone, so login returns to it. */
function Gate({ auth, status, inboxData, pagesData, chatbot }: AppProps) {
  const session = useSession(auth)
  const signOut = () => void auth.signOut()
  switch (authState(session)) {
    case 'loading':
      return null
    case 'signedOut':
      return <Login auth={auth} />
    case 'noAccess':
      return <NoAccess email={session?.user.email ?? ''} onSignOut={signOut} />
    case 'admin':
      return <Shell status={status} onSignOut={signOut} inboxData={inboxData} pagesData={pagesData} chatbot={chatbot} />
  }
}
