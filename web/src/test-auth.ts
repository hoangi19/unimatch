import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { act } from '@testing-library/react'
import { vi } from 'vitest'
import type { AuthClient } from './auth'

export function fakeSession(role?: string): Session {
  return { user: { email: 'admin@unimatch.test', app_metadata: role ? { role } : {} } } as unknown as Session
}

type Listener = (event: AuthChangeEvent, session: Session | null) => void
type SignInResult = { error: { status?: number; code?: string } | null }

/** Stand-in for `supabase.auth`. `signIn` decides the sign-in result; `emit` fires an auth event. */
export function stubAuth(initial: Session | null, signIn: () => SignInResult = () => ({ error: null })) {
  let listener: Listener = () => {}
  const emit = (event: AuthChangeEvent, session: Session | null) => act(() => listener(event, session))
  const auth = {
    onAuthStateChange: vi.fn((callback: Listener) => {
      listener = callback
      callback('INITIAL_SESSION', initial)
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    }),
    signInWithPassword: vi.fn(async () => signIn()),
    signOut: vi.fn(async () => {
      listener('SIGNED_OUT', null)
      return { error: null }
    }),
  }
  return { auth: auth as unknown as AuthClient, calls: auth, emit }
}
