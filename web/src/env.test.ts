import { describe, expect, it } from 'vitest'
import { readEnv } from './env'

describe('readEnv', () => {
  it('reads the Supabase URL and reports the key without exposing it', () => {
    expect(
      readEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }),
    ).toEqual({ supabaseUrl: 'https://x.supabase.co', hasPublishableKey: true })
  })

  it('treats missing or blank values as not configured', () => {
    expect(readEnv({ VITE_SUPABASE_URL: ' ' })).toEqual({ supabaseUrl: null, hasPublishableKey: false })
  })
})
