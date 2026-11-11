import { describe, expect, it } from 'vitest'
import { toForm, toRow, validate, type ReplyRow } from './replySettings'

const empty: ReplyRow = { reply_mode: 'always', reply_hours: {}, handoff_keywords: [], reply_delay_ms: 0 }

describe('reply settings mapping', () => {
  it('fills weekday office hours for a new row', () => {
    expect(toForm(empty)).toEqual({ mode: 'always', start: '08:00', end: '17:30', days: ['mon', 'tue', 'wed', 'thu', 'fri'], keywords: '', delayS: 0 })
  })

  it('writes the contract shape and reads it back', () => {
    const row = toRow({ mode: 'hours', start: '09:00', end: '18:00', days: ['mon', 'sat'], keywords: ' human, nhân viên,,human ', delayS: 3 })
    expect(row).toEqual({
      reply_mode: 'hours',
      reply_hours: {
        tz: 'Asia/Ho_Chi_Minh',
        days: { mon: [['09:00', '18:00']], tue: [], wed: [], thu: [], fri: [], sat: [['09:00', '18:00']], sun: [] },
      },
      handoff_keywords: ['human', 'nhân viên'],
      reply_delay_ms: 3000,
    })
    expect(toForm(row)).toEqual({ mode: 'hours', start: '09:00', end: '18:00', days: ['mon', 'sat'], keywords: 'human, nhân viên', delayS: 3 })
  })

  it('clamps the delay to 0-10 s', () => {
    expect(toRow({ ...toForm(empty), delayS: 12 }).reply_delay_ms).toBe(10000)
    expect(toRow({ ...toForm(empty), delayS: -1 }).reply_delay_ms).toBe(0)
  })
})

describe('validate', () => {
  const hours = { ...toForm(empty), mode: 'hours' as const }
  it('accepts always mode and valid hours', () => {
    expect(validate({ ...hours, mode: 'always', days: [] })).toEqual({})
    expect(validate(hours)).toEqual({})
  })
  it('needs a day and start before end', () => {
    expect(validate({ ...hours, days: [], start: '18:00', end: '09:00' })).toEqual({ days: 'pages.ps.errDays', end: 'pages.ps.errRange' })
    expect(validate({ ...hours, end: '' })).toEqual({ end: 'pages.ps.errRange' })
  })
})
