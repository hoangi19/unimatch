// What the Dataset tab needs from the outside world. Injected so tests run without Supabase.
import type { MessageKey } from '../i18n'
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

export type JobStats = { total: number; bySource: Record<JobSource, number>; recent: number; embedded: number }

/** The job embedding model (embedding_model row). The key itself never reaches the browser, only its hint. */
export type EmbeddingRow = Pick<Tables<'embedding_model'>, 'provider' | 'base_url' | 'model' | 'dims' | 'key_hint' | 'key_saved_at'>
/** A key of null removes the saved key; undefined leaves it alone. */
export type EmbeddingChange = { base_url?: string; model?: string; key?: string | null }
export type EmbedTestErrorKind = 'auth' | 'rate_limit' | 'timeout' | 'bad_config' | 'bad_request' | 'provider' | 'refused'
export type EmbedTestResult =
  | { ok: true; model: string; dims: number; latencyMs: number }
  | { ok: false; error: { kind: EmbedTestErrorKind; message: string } }
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
  /** Throws on a database error. */
  loadEmbedding(): Promise<EmbeddingRow>
  /** Saves the connection, then the key; throws with the database message (never the key). */
  saveEmbedding(change: EmbeddingChange): Promise<void>
  /** `test-embedding` Edge Function: embeds a sample text with the saved config and checks the vector size. */
  testEmbedding(): Promise<EmbedTestResult>
}

export type EmbeddingForm = { base_url: string; model: string; key: string; removeKey: boolean }

/** Only what changed; null removes the saved key. */
export function embeddingChange(row: EmbeddingRow, form: EmbeddingForm): EmbeddingChange {
  const change: EmbeddingChange = {}
  if (form.base_url.trim() !== row.base_url) change.base_url = form.base_url.trim()
  if (form.model.trim() !== row.model) change.model = form.model.trim()
  if (form.key.trim()) change.key = form.key.trim()
  else if (form.removeKey) change.key = null
  return change
}

/** Field errors as message keys; mirrors the embedding_model checks and set_embedding_key. */
export function embeddingErrors(form: EmbeddingForm) {
  const errors: Partial<Record<'base_url' | 'model' | 'key', MessageKey>> = {}
  if (!/^https:\/\/\S+$/.test(form.base_url.trim()) || form.base_url.trim().length > 500) errors.base_url = 'dataset.emb.err.baseUrl'
  if (!form.model.trim() || form.model.trim().length > 200) errors.model = 'dataset.emb.err.model'
  const key = form.key.trim()
  if (key && (key.length < 8 || key.length > 512 || /\s/.test(key))) errors.key = 'dataset.emb.err.key'
  return errors
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
