// Typed client for the `pages` Edge Function. `accessToken` is the admin's Supabase session token;
// `userToken` is the Facebook user token from facebookLogin(). The function never returns a token.

export type PageSummary = { id: string; name: string; pictureUrl: string | null; tasks: string[] }
export type PagesErrorKind =
  | 'bad_config'
  | 'token_expired'
  | 'permission_denied'
  | 'rate_limit'
  | 'bad_request'
  | 'graph'
  | 'no_pages'
  | 'not_found'
  | 'missing_task'
  | 'unauthorized'
export type PagesResult<T> = ({ ok: true } & T) | { ok: false; error: { kind: PagesErrorKind; message: string } }

type Env = Record<string, string | undefined>

async function call<T>(accessToken: string, body: Record<string, string>, env: Env): Promise<PagesResult<T>> {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/pages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: { kind: 'unauthorized', message: res.status === 401 ? 'Sign in required' : 'Admin only' } }
  }
  const data = await res.json().catch(() => null)
  if (data && typeof data.ok === 'boolean') return data as PagesResult<T>
  return { ok: false, error: { kind: 'graph', message: `Unexpected response (HTTP ${res.status})` } }
}

export const listPages = (accessToken: string, userToken: string, env: Env = import.meta.env) =>
  call<{ pages: PageSummary[] }>(accessToken, { action: 'list', userToken }, env)

export const connectPage = (accessToken: string, userToken: string, pageId: string, env: Env = import.meta.env) =>
  call<{ page: PageSummary; replayed: number }>(accessToken, { action: 'connect', userToken, pageId }, env)

export const disconnectPage = (accessToken: string, pageId: string, env: Env = import.meta.env) =>
  call<object>(accessToken, { action: 'disconnect', pageId }, env)
