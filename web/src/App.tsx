import { I18nProvider } from './i18n'
import { Shell, type SystemStatus } from './Shell'
import { ToastProvider } from './ui/ToastProvider'

type AppProps = { status?: SystemStatus; onSignOut?: () => void }

// Login (#12) wraps this shell and passes onSignOut; status values arrive with later screens.
export default function App(props: AppProps) {
  return (
    <I18nProvider>
      <ToastProvider>
        <Shell {...props} />
      </ToastProvider>
    </I18nProvider>
  )
}
