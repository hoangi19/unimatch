import { expect, it } from 'vitest'
import { tabFromPath } from './router'

it('maps tab paths, ignoring slashes', () => {
  expect(tabFromPath('/pages')).toBe('pages')
  expect(tabFromPath('/chatbot/')).toBe('chatbot')
  expect(tabFromPath('/dataset')).toBe('dataset')
})

it('returns null for the root and unknown paths', () => {
  expect(tabFromPath('/')).toBeNull()
  expect(tabFromPath('/nope')).toBeNull()
  expect(tabFromPath('/pages/extra')).toBeNull()
})
