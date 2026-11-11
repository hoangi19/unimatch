import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { Button } from './controls'
import { Icon } from './Icon'
import { TOAST_MS, ToastContext, type ToastInput } from './toast-context'

type ToastItem = ToastInput & { id: number }

const ICONS = { success: 'check', error: 'alert', info: 'info' } as const

/** Toasts stack bottom-right (bottom on mobile) so they never cover the topbar or status bar. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const { t } = useI18n()

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), [])

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++
      setToasts((list) => [...list, { ...toast, id }])
      setTimeout(() => dismiss(id), TOAST_MS)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(({ id, kind = 'info', title, body }) => (
          <div key={id} className={`toast ${kind}`}>
            <Icon name={ICONS[kind]} />
            <div className="t-body">
              <strong>{title}</strong>
              {body && <span>{body}</span>}
            </div>
            <Button variant="ghost" size="sm" icon="x" label={t('common.dismiss')} onClick={() => dismiss(id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
