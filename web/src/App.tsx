import { authState, useSession, type AuthClient } from './auth'
import { I18nProvider } from './i18n'
import { Login, NoAccess } from './Login'
import { Shell, type SystemStatus } from './Shell'
import { ToastProvider } from './ui/ToastProvider'

type AppProps = { auth: AuthClient; status?: SystemStatus }

// Status values arrive with later screens.
export default function App(props: AppProps) {
  return (
    <I18nProvider>
      <ToastProvider>
        <Gate {...props} />
      </ToastProvider>
    </I18nProvider>
  )
}

/** Route guard: every path needs an admin session. The URL is left alone, so login returns to it. */
function Gate({ auth, status }: AppProps) {
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
      return <Shell status={status} onSignOut={signOut} />
  }
}
