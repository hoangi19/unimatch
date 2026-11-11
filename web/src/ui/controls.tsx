import { useId, type ComponentProps, type InputHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'cta' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'sm'
  icon?: IconName
  /** Icon-only button: `label` becomes the accessible name. */
  label?: string
}

export function Button({ variant = 'secondary', size = 'md', icon, label, className = '', children, ...rest }: ButtonProps) {
  const iconOnly = label !== undefined && children === undefined
  const classes = ['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', iconOnly && 'btn-icon', className]
  return (
    <button type="button" className={classes.filter(Boolean).join(' ')} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
  /** Control placed inside the input's right edge, e.g. a show-password button. */
  end?: ReactNode
}

export function Input({ label, hint, error, end, id, ...rest }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const noteId = `${inputId}-note`
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className={end ? 'input-wrap' : undefined}>
        <input
          id={inputId}
          className="input"
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? noteId : undefined}
          {...rest}
        />
        {end}
      </div>
      {error ? (
        <p id={noteId} className="err">
          <Icon name="alert" />
          {error}
        </p>
      ) : (
        hint && <p id={noteId} className="hint">{hint}</p>
      )}
    </div>
  )
}

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function Toggle({ label, checked, onChange, ...rest }: ToggleProps) {
  return (
    <label className="switch-label">
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} {...rest} />
      {label}
    </label>
  )
}

export function Skeleton({ width = '100%', height = 12 }: { width?: string | number; height?: number }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} className="ic ic-xl" />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}
