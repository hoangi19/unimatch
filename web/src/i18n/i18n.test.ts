import { expect, it } from 'vitest'
import { en } from './en'
import { format, storedLang, translate } from '.'
import { vi as viDict } from './vi'

it('defaults to Vietnamese and remembers English', () => {
  expect(storedLang()).toBe('vi')
  localStorage.setItem('um-lang', 'en')
  expect(storedLang()).toBe('en')
  localStorage.setItem('um-lang', 'fr')
  expect(storedLang()).toBe('vi')
})

it('translates and fills placeholders', () => {
  expect(translate('vi', 'tab.inbox')).toBe('Hộp thư')
  expect(translate('en', 'tab.inbox')).toBe('Inbox')
  expect(format('{n} of {total}', { n: 1, total: 3 })).toBe('1 of 3')
  expect(format('{n} of {total}', { n: 1 })).toBe('1 of {total}')
})

it('has no empty strings in either dictionary', () => {
  for (const dict of [en, viDict]) expect(Object.values(dict).filter((v) => !v.trim())).toEqual([])
})
