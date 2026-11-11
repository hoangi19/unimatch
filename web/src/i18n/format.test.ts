import { expect, it } from 'vitest'
import { formatter } from './format'

const vi = formatter('vi')
const en = formatter('en')

it('formats numbers with each language’s separators', () => {
  expect(vi.number(12345.6)).toBe('12.345,6')
  expect(en.number(12345.6)).toBe('12,345.6')
  expect(vi.percent(0.75)).toBe('75%')
})

it('formats dates and durations per locale', () => {
  const day = new Date(2026, 10, 3)
  expect(vi.date(day)).toBe('3 thg 11, 2026')
  expect(en.date(day)).toBe('Nov 3, 2026')
  expect(vi.duration(1.8)).toBe('1,8 giây')
  expect(en.duration(180)).toBe('3 min')
  expect(en.duration(5400)).toBe('1.5 hr')
})

it('says relative days in words, lowercase for mid-sentence use', () => {
  expect(vi.relative(1, 'day')).toBe('ngày mai')
  expect(en.relative(3, 'day')).toBe('in 3 days')
  expect(vi.relative(0, 'day')).toBe('hôm nay')
})

it('shows a clock time today and a date otherwise', () => {
  const now = new Date(2026, 10, 12, 15, 0)
  const gb = formatter('en-GB')
  expect(gb.shortTime(new Date(2026, 10, 12, 9, 5).toISOString(), now)).toBe('09:05')
  expect(gb.shortTime(new Date(2026, 10, 3, 9, 5).toISOString(), now)).toBe('03/11')
  expect(gb.shortTime(new Date(2025, 10, 3, 9, 5).toISOString(), now)).toBe('03/11/2025')
})
