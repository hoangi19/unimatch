import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { Button } from './controls'

type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

/** Native <dialog>: focus trap, Escape and backdrop come from the browser. */
function Dialog({ kind, open, onClose, title, children, footer }: DialogProps & { kind: 'modal' | 'drawer' }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const { t } = useI18n()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={kind}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="panel">
        <div className="panel-head">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" icon="x" label={t('common.close')} onClick={onClose} />
        </div>
        <div className="panel-body">{children}</div>
        {footer && <div className="panel-foot">{footer}</div>}
      </div>
    </dialog>
  )
}

export function Modal(props: DialogProps) {
  return <Dialog kind="modal" {...props} />
}

export function Drawer(props: DialogProps) {
  return <Dialog kind="drawer" {...props} />
}
