import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import App from './App'

afterEach(cleanup)

it('shows the configured Supabase URL', () => {
  render(<App env={{ supabaseUrl: 'https://x.supabase.co', hasPublishableKey: true }} />)
  expect(screen.getByText('https://x.supabase.co')).toBeTruthy()
  expect(screen.getByText('configured')).toBeTruthy()
})

it('says when nothing is configured', () => {
  render(<App env={{ supabaseUrl: null, hasPublishableKey: false }} />)
  expect(screen.getAllByText('not configured')).toHaveLength(2)
})
