import { expect, it } from 'vitest'
import { distinct, recentSince, safeUrl, searchFilter } from './data'

it('builds a quoted or-filter over title, company and description', () => {
  expect(searchFilter('  bảo vệ ')).toBe('title.ilike."*bảo vệ*",company_name.ilike."*bảo vệ*",description_text.ilike."*bảo vệ*"')
  expect(searchFilter('   ')).toBeNull()
  expect(searchFilter('***')).toBeNull()
})

it('keeps PostgREST syntax and LIKE wildcards in the search literal', () => {
  const filter = searchFilter('a,b (c) "d" 50%_x*')!
  // LIKE escapes (\%, \_) are doubled once more inside the quoted value; `*` is dropped.
  expect(filter.split(',company_name')[0]).toBe('title.ilike."*a,b (c) \\"d\\" 50\\\\%\\\\_x*"')
})

it('dates "recent" from local yesterday, across month ends', () => {
  expect(recentSince(new Date(2026, 10, 12, 9))).toBe('2026-11-11')
  expect(recentSince(new Date(2026, 2, 1, 0, 30))).toBe('2026-02-28')
})

it('only lets http(s) links through', () => {
  expect(safeUrl(' https://www.linkedin.com/jobs/view/1 ')).toBe('https://www.linkedin.com/jobs/view/1')
  expect(safeUrl('javascript:alert(1)')).toBeNull()
  expect(safeUrl(null)).toBeNull()
})

it('lists distinct non-empty values in order', () => {
  expect(distinct(['Part-time', null, 'Full-time', '', 'Part-time'])).toEqual(['Full-time', 'Part-time'])
})
