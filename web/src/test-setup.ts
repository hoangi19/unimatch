import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// jsdom has no matchMedia; tests flip `prefersDark` and fire `emitSchemeChange`.
type Listener = () => void
const listeners = new Set<Listener>()
export const media = { prefersDark: false }
export function emitSchemeChange(dark: boolean) {
  media.prefersDark = dark
  listeners.forEach((listener) => listener())
}

vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('dark') && media.prefersDark
  },
  media: query,
  addEventListener: (_: string, listener: Listener) => listeners.add(listener),
  removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
}))

beforeEach(() => {
  localStorage.clear()
  media.prefersDark = false
  history.replaceState(null, '', '/')
})

afterEach(cleanup)
