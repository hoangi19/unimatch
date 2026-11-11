import { describe, expect, it } from 'vitest'
import { type FacebookSdk, facebookLogin } from './facebook'

function sdk(status: 'connected' | 'unknown', seen: { configId?: string } = {}): () => Promise<FacebookSdk> {
  return () =>
    Promise.resolve({
      init: () => {},
      login: (cb, options) => {
        seen.configId = options.config_id
        cb({ status, authResponse: status === 'connected' ? { accessToken: 'fb-user' } : null })
      },
    })
}

describe('facebookLogin', () => {
  it('returns the user token and uses the login config', async () => {
    const seen: { configId?: string } = {}
    expect(await facebookLogin('cfg-1', sdk('connected', seen))).toBe('fb-user')
    expect(seen.configId).toBe('cfg-1')
  })

  it('rejects when the popup is cancelled', async () => {
    await expect(facebookLogin('cfg-1', sdk('unknown'))).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('rejects without a config id', async () => {
    await expect(facebookLogin('', sdk('connected'))).rejects.toMatchObject({ kind: 'sdk' })
  })
})
