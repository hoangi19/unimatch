// Imports scraped job postings into public.jobs, upserting on (source, external_id).
// Usage: deno run --env-file=.env -A scripts/import-jobs.ts <path-to-jobs.json>
// Prints counts only: the file holds personal data, so record contents are never logged.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type Raw = Record<string, unknown>;

export type JobRow = {
  source: string;
  external_id: string;
  source_name: string | null;
  title: string;
  company_name: string | null;
  company_linkedin_url: string | null;
  company_logo: string | null;
  location: string | null;
  salary: string | null;
  employment_type: string | null;
  seniority_level: string | null;
  industries: string | null;
  description_text: string | null;
  description_html: string | null;
  link: string | null;
  apply_url: string | null;
  applicants_count: number | null;
  benefits: string[];
  posted_at: string | null;
  scraped_at: string | null;
  raw: Raw;
};

export type Normalized = { row: JobRow } | { skip: string };

// Scrapers write missing values as null, "null" or "".
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" || s === "null" ? null : s;
}

function int(value: unknown): number | null {
  const s = text(value);
  return s !== null && /^\d+$/.test(s) ? Number(s) : null;
}

function benefits(value: unknown): string[] {
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = [value];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.map(text).filter((b): b is string => b !== null);
}

function date(value: unknown): string | null {
  const s = text(value);
  // Round-trip rejects dates like 2026-02-30 that Postgres would refuse, failing the whole batch.
  return s !== null && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s
    ? s
    : null;
}

function timestamp(value: unknown): string | null {
  const s = text(value);
  return s !== null && !isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
}

export function normalize(record: Raw): Normalized {
  const external_id = text(record.id);
  const source = text(record.source);
  const title = text(record.title);
  if (!external_id) return { skip: "missing id" };
  if (!source) return { skip: "missing source" };
  if (!/^[a-z][a-z0-9_]*$/.test(source)) return { skip: "invalid source" };
  if (!title) return { skip: "missing title" };
  return {
    row: {
      source,
      external_id,
      source_name: text(record.sourceName),
      title,
      company_name: text(record.companyName),
      company_linkedin_url: text(record.companyLinkedinUrl),
      company_logo: text(record.companyLogo),
      location: text(record.location),
      salary: text(record.salary),
      employment_type: text(record.employmentType),
      seniority_level: text(record.seniorityLevel),
      industries: text(record.industries),
      description_text: text(record.descriptionText),
      description_html: text(record.descriptionHtml),
      link: text(record.link),
      apply_url: text(record.applyUrl),
      applicants_count: int(record.applicantsCount),
      benefits: benefits(record.benefits),
      posted_at: date(record.postedAt),
      scraped_at: timestamp(record.scrapedAt),
      raw: record,
    },
  };
}

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) throw new Error("usage: import-jobs.ts <path-to-jobs.json>");
  const records: unknown = JSON.parse(await Deno.readTextFile(path));
  if (!Array.isArray(records)) throw new Error("expected a JSON array of job records");

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set (use --env-file=.env)");
  const client = createClient(url, key);

  const rows = new Map<string, JobRow>();
  const skipped = new Map<string, number>();
  for (const record of records) {
    const result = record && typeof record === "object" ? normalize(record as Raw) : { skip: "not an object" };
    if ("skip" in result) {
      skipped.set(result.skip, (skipped.get(result.skip) ?? 0) + 1);
    } else {
      const k = `${result.row.source}\u0000${result.row.external_id}`;
      if (rows.has(k)) skipped.set("duplicate in file", (skipped.get("duplicate in file") ?? 0) + 1);
      rows.set(k, result.row);
    }
  }

  // PostgREST cannot say which upserted rows were new, so look the keys up first.
  // shortcut: loads every existing key, fine for thousands of rows; page it when the table grows past that.
  const { data: existing, error: readError } = await client.from("jobs").select("source, external_id");
  if (readError) throw new Error(`jobs: ${readError.message}`);
  const known = new Set(existing.map((r) => `${r.source}\u0000${r.external_id}`));

  const now = new Date().toISOString();
  const payload = [...rows.values()].map((row) => ({ ...row, updated_at: now }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await client.from("jobs").upsert(payload.slice(i, i + 500), { onConflict: "source,external_id" });
    if (error) throw new Error(`jobs: ${error.message}`);
  }

  const updated = [...rows.keys()].filter((k) => known.has(k)).length;
  const skippedTotal = [...skipped.values()].reduce((a, b) => a + b, 0);
  console.log(`inserted ${rows.size - updated}, updated ${updated}, skipped ${skippedTotal}`);
  for (const [reason, count] of skipped) console.log(`  skipped ${count}: ${reason}`);
}
