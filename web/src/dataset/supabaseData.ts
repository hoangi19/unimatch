import { supabase } from '../lib/supabase'
import { distinct, JOB_DETAIL_COLUMNS, JOB_LIST_COLUMNS, JOB_SOURCES, PAGE_SIZE, searchFilter, type DatasetData, type EmbedTestResult, type JobDetail } from './data'

const head = () => supabase.from('jobs').select('*', { count: 'exact', head: true })

/** Row count of a HEAD query. */
async function countOf(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

export const supabaseDatasetData: DatasetData = {
  async loadStats(since) {
    const model = await supabase.from('embedding_model').select('model').single()
    if (model.error) throw new Error(model.error.message)
    const [total, linkedin, facebook_group, recent, embedded] = await Promise.all([
      countOf(head()),
      ...JOB_SOURCES.map((s) => countOf(head().eq('source', s))),
      countOf(head().gte('posted_at', since)),
      // Every embedded job has a chunk 0, so this counts jobs, not chunks.
      countOf(supabase.from('job_chunks').select('*', { count: 'exact', head: true }).eq('chunk_index', 0).eq('model', model.data.model)),
    ])
    return { total, bySource: { linkedin, facebook_group }, recent, embedded }
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
  async loadEmbedding() {
    const { data, error } = await supabase.from('embedding_model').select('provider, base_url, model, dims, key_hint, key_saved_at').single()
    if (error) throw new Error(error.message)
    return data
  },
  async saveEmbedding({ key, ...update }) {
    if (Object.keys(update).length) {
      const { error } = await supabase.from('embedding_model').update(update).eq('id', true)
      if (error) throw new Error(error.message)
    }
    if (key !== undefined) {
      const { error } = key === null ? await supabase.rpc('remove_embedding_key') : await supabase.rpc('set_embedding_key', { p_key: key })
      if (error) throw new Error(error.message)
    }
  },
  async testEmbedding() {
    const { data } = await supabase.functions.invoke<EmbedTestResult>('test-embedding', { body: {} })
    return data && typeof data.ok === 'boolean' ? data : { ok: false, error: { kind: 'provider', message: 'Unexpected response' } }
  },
}
