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

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

it('has the same keys and placeholders in Vietnamese and English', () => {
  expect(Object.keys(viDict).sort()).toEqual(Object.keys(en).sort())
  const key = (k: string) => k as keyof typeof en
  expect(Object.keys(en).filter((k) => placeholders(en[key(k)]).join() !== placeholders(viDict[key(k)]).join())).toEqual([])
})

// jsx-no-literals (oxlint) covers JSX text; this covers the attributes people read or hear.
it('keeps user-facing attributes out of component source', () => {
  const sources = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true })
  expect(Object.keys(sources).length).toBeGreaterThan(10)
  const technical = ['https://llm.example.com/v1', 'X-Api-Version']
  const found = Object.entries(sources).flatMap(([file, src]) =>
    [...(src as string).matchAll(/\b(aria-label|title|placeholder|alt)="([^"]*[\p{L}][^"]*)"/gu)]
      .filter((m) => !technical.includes(m[2]))
      .map((m) => `${file}: ${m[0]}`),
  )
  expect(found).toEqual([])
})
