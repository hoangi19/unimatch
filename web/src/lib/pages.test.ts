import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectPage, disconnectPage, listPages } from './pages'

const ENV = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(() => Promise.resolve(Response.json(body, { status })))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('pages client', () => {
  it('posts the action with the admin token and publishable key', async () => {
    const fn = stubFetch(200, { ok: true, pages: [] })
    expect(await listPages('session', 'fb-user', ENV)).toEqual({ ok: true, pages: [] })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://x.supabase.co/functions/v1/pages')
    expect(init.headers).toMatchObject({ authorization: 'Bearer session', apikey: 'sb_publishable_x' })
    expect(JSON.parse(init.body as string)).toEqual({ action: 'list', userToken: 'fb-user' })
  })

  it('sends the page id for connect and disconnect', async () => {
    const fn = stubFetch(200, { ok: true })
    await connectPage('session', 'fb-user', '1531', ENV)
    await disconnectPage('session', '1531', ENV)
    const bodies = fn.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))
    expect(bodies).toEqual([
      { action: 'connect', userToken: 'fb-user', pageId: '1531' },
      { action: 'disconnect', pageId: '1531' },
    ])
  })

  it('passes function errors through', async () => {
    stubFetch(200, { ok: false, error: { kind: 'missing_task', message: 'x' } })
    expect(await connectPage('session', 'fb-user', '1531', ENV)).toEqual({ ok: false, error: { kind: 'missing_task', message: 'x' } })
  })

  it('maps 401 and 403 to unauthorized', async () => {
    stubFetch(403, { error: 'Admin only' })
    expect(await disconnectPage('session', '1531', ENV)).toMatchObject({ ok: false, error: { kind: 'unauthorized' } })
  })
})
