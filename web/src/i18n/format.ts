import type { Lang } from './core'

export const LOCALES: Record<Lang, string> = { vi: 'vi-VN', en: 'en-US' }

export type Format = ReturnType<typeof formatter>

/** Locale-aware numbers, dates and durations for one UI language. */
export function formatter(lang: Lang | string) {
  const locale = LOCALES[lang as Lang] ?? lang
  const number = (n: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(n)
  const date = (value: string | Date, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) =>
    new Intl.DateTimeFormat(locale, options).format(new Date(value))
  const unit = (n: number, unit: 'second' | 'minute' | 'hour') => number(n, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 })
  return {
    locale,
    number,
    percent: (ratio: number) => number(ratio, { style: 'percent' }),
    date,
    /** Clock time for today, a short date otherwise (with the year when it differs). */
    shortTime(value: string, now = new Date()) {
      const d = new Date(value)
      if (d.toDateString() === now.toDateString()) return date(d, { hour: '2-digit', minute: '2-digit' })
      return date(d, { day: 'numeric', month: 'numeric', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) })
    },
    /** "in 3 days", "tomorrow", "ngày mai", lowercased to sit mid-sentence. */
    relative(n: number, unit: Intl.RelativeTimeFormatUnit) {
      const text = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(n, unit)
      return text.charAt(0).toLocaleLowerCase(locale) + text.slice(1)
    },
    /** Seconds as "45 sec", "3 min" or "1.5 hr". */
    duration(seconds: number) {
      if (seconds < 60) return unit(seconds, 'second')
      if (seconds < 3600) return unit(Math.round(seconds / 60), 'minute')
      return unit(seconds / 3600, 'hour')
    },
  }
}
