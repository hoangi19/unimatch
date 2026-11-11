import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'error' | 'info'
export type ToastInput = { kind?: ToastKind; title: string; body?: string }

export const TOAST_MS = 5000

export const ToastContext = createContext<((toast: ToastInput) => void) | null>(null)

export function useToast() {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast needs a ToastProvider')
  return show
}
