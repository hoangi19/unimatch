// Embeds public.jobs into public.job_chunks with the saved embedding model (Dataset tab settings).
// Usage: deno run --env-file=.env -A scripts/embed-jobs.ts
// Only new or changed chunks are embedded (content_hash), so a re-run with no changes embeds nothing.
// Prints counts only: job text and the key are never logged.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { loadEmbedding } from "../supabase/functions/_shared/ai/config.ts";
import { embed } from "../supabase/functions/_shared/ai/embed.ts";
import { type ChunkSource, chunks, contentHash } from "../supabase/functions/_shared/jobs/chunks.ts";

export type JobText = ChunkSource & { source: string; external_id: string };
export type ExistingChunk = { source: string; external_id: string; chunk_index: number; content_hash: string };
export type PlannedChunk = { source: string; external_id: string; chunk_index: number; content_hash: string; text: string };
export type Plan = { embed: PlannedChunk[]; skipped: number; remove: ExistingChunk[] };

const BATCH = 16;
const key = (c: { source: string; external_id: string }, i: number) => `${c.source}\u0000${c.external_id}\u0000${i}`;

// Embed what is new or changed; remove chunks past a job's new chunk count. Deleted jobs cascade in the database.
export async function plan(jobs: JobText[], existing: ExistingChunk[], model: string): Promise<Plan> {
  const known = new Map(existing.map((c) => [key(c, c.chunk_index), c.content_hash]));
  const wanted = new Set<string>();
  const out: Plan = { embed: [], skipped: 0, remove: [] };
  for (const job of jobs) {
    const parts = chunks(job);
    for (const [i, text] of parts.entries()) {
      const k = key(job, i);
      wanted.add(k);
      const content_hash = await contentHash(model, text);
      if (known.get(k) === content_hash) out.skipped++;
      else out.embed.push({ source: job.source, external_id: job.external_id, chunk_index: i, content_hash, text });
    }
  }
  out.remove = existing.filter((c) => !wanted.has(key(c, c.chunk_index)));
  return out;
}

if (import.meta.main) {
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !secret) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set (use --env-file=.env)");
  const db = createClient(url, secret);
  const config = await loadEmbedding(db);

  // shortcut: one read each, under PostgREST's 1,000-row cap for ~100 jobs; page both reads past a few hundred jobs.
  const [jobs, existing] = await Promise.all([
    db.from("jobs").select("source, external_id, title, company_name, location, salary, employment_type, description_text"),
    db.from("job_chunks").select("source, external_id, chunk_index, content_hash"),
  ]);
  if (jobs.error) throw new Error(`jobs: ${jobs.error.message}`);
  if (existing.error) throw new Error(`job_chunks: ${existing.error.message}`);
  const todo = await plan(jobs.data, existing.data, config.model);

  let embedded = 0;
  let failed = 0;
  for (let i = 0; i < todo.embed.length; i += BATCH) {
    const batch = todo.embed.slice(i, i + BATCH);
    try {
      const { vectors } = await embed(config, batch.map((c) => c.text));
      const rows = batch.map(({ text: _text, ...c }, n) => ({ ...c, model: config.model, embedding: JSON.stringify(vectors[n]) }));
      const { error } = await db.from("job_chunks").upsert(rows, { onConflict: "source,external_id,chunk_index" });
      if (error) throw new Error(`job_chunks: ${error.message}`);
      embedded += batch.length;
    } catch (e) {
      failed += batch.length;
      // AiError messages are redacted and never hold the input text.
      console.error(`batch of ${batch.length} failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  let removed = 0;
  for (const c of todo.remove) {
    const { error } = await db.from("job_chunks").delete()
      .eq("source", c.source).eq("external_id", c.external_id).eq("chunk_index", c.chunk_index);
    if (error) console.error(`could not remove a stale chunk: ${error.message}`);
    else removed++;
  }

  console.log(`jobs ${jobs.data.length}: embedded ${embedded}, skipped ${todo.skipped}, failed ${failed}, removed ${removed} chunks`);
  if (failed) Deno.exit(1);
}
