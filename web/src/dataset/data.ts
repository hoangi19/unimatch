// What the Dataset tab needs from the outside world. Injected so tests run without Supabase.
import type { Tables } from '../lib/database.types'

export const JOB_SOURCES = ['linkedin', 'facebook_group'] as const
export type JobSource = (typeof JOB_SOURCES)[number]

export const PAGE_SIZE = 25

// The list never loads raw or the description: both can be large.
export const JOB_LIST_COLUMNS = 'source, external_id, title, company_name, location, salary, posted_at'
export type JobListRow = Pick<Tables<'jobs'>, 'source' | 'external_id' | 'title' | 'company_name' | 'location' | 'salary' | 'posted_at'>

// Personal data lives only in raw; pick single keys from it, never the whole object.
export const JOB_DETAIL_COLUMNS =
  'source, external_id, source_name, title, company_name, location, salary, employment_type, seniority_level, industries, ' +
  'description_text, link, apply_url, applicants_count, benefits, posted_at, scraped_at, ' +
  'contact:raw->>contact, poster_name:raw->>jobPosterName, poster_title:raw->>jobPosterTitle, poster_url:raw->>jobPosterProfileUrl'
export type JobDetail = Pick<
  Tables<'jobs'>,
  | 'source'
  | 'external_id'
  | 'source_name'
  | 'title'
  | 'company_name'
  | 'location'
  | 'salary'
  | 'employment_type'
  | 'seniority_level'
  | 'industries'
  | 'description_text'
  | 'link'
  | 'apply_url'
  | 'applicants_count'
  | 'benefits'
  | 'posted_at'
  | 'scraped_at'
> & { contact: string | null; poster_name: string | null; poster_title: string | null; poster_url: string | null }

/** Empty strings mean "any". */
export type JobQuery = { q: string; source: string; type: string; seniority: string }
export const NO_QUERY: JobQuery = { q: '', source: '', type: '', seniority: '' }

export type JobStats = { total: number; bySource: Record<JobSource, number>; recent: number }
export type Facets = { types: string[]; seniorities: string[] }

export type DatasetData = {
  /** Throws on a database error. `since` is the first posted_at date that counts as recent. */
  loadStats(since: string): Promise<JobStats>
  /** One page, newest first, with the total that matches the query. Throws on a database error. */
  loadJobs(query: JobQuery, offset: number): Promise<{ rows: JobListRow[]; total: number }>
  /** Throws on a database error or when the job is gone. */
  loadJob(source: string, externalId: string): Promise<JobDetail>
  /** Distinct employment types and seniority levels for the filters. */
  loadFacets(): Promise<Facets>
}

/** Yesterday as a local YYYY-MM-DD date: "posted in the last 24h" is posted_at >= this. */
export function recentSince(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * PostgREST `or` filter matching the text in title, company or description, or null for an empty search.
 * LIKE wildcards in the text match literally; the value is quoted so commas and parentheses are safe.
 */
export function searchFilter(text: string): string | null {
  // `*` is PostgREST's wildcard and cannot be escaped, so it is dropped.
  const term = text.trim().replace(/\*/g, '')
  if (!term) return null
  const like = term.replace(/[\\%_]/g, '\\$&')
  const quoted = `"*${like.replace(/[\\"]/g, '\\$&')}*"`
  return ['title', 'company_name', 'description_text'].map((col) => `${col}.ilike.${quoted}`).join(',')
}

/** Sorted distinct non-empty values. */
export function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort()
}

/** The URL when it is http(s), else null: crawled links must never become `javascript:` hrefs. */
export function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null
}

/** A posted_at date (YYYY-MM-DD) as local midnight, so it shows the same day in every time zone. */
export const localDate = (date: string) => `${date}T00:00`
