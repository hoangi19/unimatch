import { expect, it } from 'vitest'
import { mockEmbedStatus, runStep } from './mock'

it('maps progress to queued, fetch, parse and embed', () => {
  expect([0, 5, 6, 57, 58, 74, 100].map(runStep)).toEqual([-1, -1, 0, 0, 1, 2, 2])
})

it('gives each job a stable fake embedding status', () => {
  expect(mockEmbedStatus('4321')).toBe(mockEmbedStatus('4321'))
  const all = new Set(Array.from({ length: 50 }, (_, i) => mockEmbedStatus(String(i))))
  expect(all).toEqual(new Set(['embedded', 'pending', 'failed']))
})
