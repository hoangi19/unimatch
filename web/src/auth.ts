import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

export type AuthClient = Pick<SupabaseClient['auth'], 'onAuthStateChange' | 'signInWithPassword' | 'signOut'>
export type AuthState = 'loading' | 'signedOut' | 'noAccess' | 'admin'
export type SignInError = 'wrong' | 'network' | 'rateLimit'

/** `undefined` means the stored session has not been read yet. Admin rule matches SQL `is_admin()`. */
export function authState(session: Session | null | undefined): AuthState {
  if (session === undefined) return 'loading'
  if (!session) return 'signedOut'
  return session.user.app_metadata?.role === 'admin' ? 'admin' : 'noAccess'
}

export function signInError(error: { status?: number; code?: string }): SignInError {
  if (error.status === 429 || error.code === 'over_request_rate_limit') return 'rateLimit'
  if (error.status === 400 || error.code === 'invalid_credentials') return 'wrong'
  // Fetch failures (status 0) and server errors: the request did not get a real answer.
  return 'network'
}

/** Current session; the first event (INITIAL_SESSION) carries the one restored from storage. */
export function useSession(auth: AuthClient) {
  const [session, setSession] = useState<Session | null>()
  useEffect(() => {
    const { data } = auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [auth])
  return session
}
