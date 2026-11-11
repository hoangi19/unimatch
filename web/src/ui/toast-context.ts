import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'error' | 'info'
/** `action` adds one button, e.g. Undo; clicking it also dismisses the toast. */
export type ToastInput = { kind?: ToastKind; title: string; body?: string; action?: { label: string; onClick: () => void } }

export const TOAST_MS = 5000

export const ToastContext = createContext<((toast: ToastInput) => void) | null>(null)

export function useToast() {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast needs a ToastProvider')
  return show
}
