import { supabase } from '../lib/supabase'
import { distinct, JOB_DETAIL_COLUMNS, JOB_LIST_COLUMNS, JOB_SOURCES, PAGE_SIZE, searchFilter, type DatasetData, type JobDetail } from './data'

const head = () => supabase.from('jobs').select('*', { count: 'exact', head: true })

/** Row count of a HEAD query. */
async function countOf(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

export const supabaseDatasetData: DatasetData = {
  async loadStats(since) {
    const [total, linkedin, facebook_group, recent] = await Promise.all([
      countOf(head()),
      ...JOB_SOURCES.map((s) => countOf(head().eq('source', s))),
      countOf(head().gte('posted_at', since)),
    ])
    return { total, bySource: { linkedin, facebook_group }, recent }
  },
  async loadJobs(query, offset) {
    let q = supabase.from('jobs').select(JOB_LIST_COLUMNS, { count: 'exact' })
    const search = searchFilter(query.q)
    if (search) q = q.or(search)
    if (query.source) q = q.eq('source', query.source)
    if (query.type) q = q.eq('employment_type', query.type)
    if (query.seniority) q = q.eq('seniority_level', query.seniority)
    const { data, count: total, error } = await q
      .order('posted_at', { ascending: false, nullsFirst: false })
      .order('external_id')
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    return { rows: data, total: total ?? data.length }
  },
  async loadJob(source, externalId) {
    const { data, error } = await supabase
      .from('jobs')
      .select(JOB_DETAIL_COLUMNS)
      .eq('source', source)
      .eq('external_id', externalId)
      .single()
    if (error) throw new Error(error.message)
    return data as unknown as JobDetail
  },
  async loadFacets() {
    // shortcut: reads two short columns of every row; move to a distinct RPC if the table grows past a few thousand rows.
    const { data, error } = await supabase.from('jobs').select('employment_type, seniority_level')
    if (error) throw new Error(error.message)
    return { types: distinct(data.map((r) => r.employment_type)), seniorities: distinct(data.map((r) => r.seniority_level)) }
  },
}
