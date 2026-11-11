import { describe, expect, it } from 'vitest'
import { readEnv } from './env'

describe('readEnv', () => {
  it('reads the Supabase URL and publishable key', () => {
    expect(
      readEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }),
    ).toEqual({ supabaseUrl: 'https://x.supabase.co', publishableKey: 'sb_publishable_x' })
  })

  it('treats missing or blank values as not configured', () => {
    expect(readEnv({ VITE_SUPABASE_URL: ' ' })).toEqual({ supabaseUrl: null, publishableKey: null })
  })
})
