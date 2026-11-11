// Seeds demo rows into the hosted project, or removes them with --clean.
// Usage: deno run --env-file=.env -A scripts/seed.ts [--clean]
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { cleanOrder, type Filter, hasSeedPrefixFilter, REGISTRY, type SeedEntry } from "./seed_registry.ts";

type Filterable<T> = { eq(column: string, value: string): T; like(column: string, value: string): T };

function applyFilters<T extends Filterable<T>>(query: T, filters: Filter[]): T {
  return filters.reduce(
    (q, f) => (f.op === "eq" ? q.eq(f.column, f.value) : q.like(f.column, f.value)),
    query,
  );
}

function fail(table: string, message: string): never {
  throw new Error(`${table}: ${message}`);
}

async function countRows(client: ReturnType<typeof makeClient>, entry: SeedEntry): Promise<number> {
  const query = client.from(entry.table).select("*", { count: "exact", head: true });
  const { count, error } = await applyFilters(query, entry.match);
  if (error) fail(entry.table, error.message);
  return count ?? 0;
}

function makeClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set (use --env-file=.env)");
  return createClient(url, key);
}

if (import.meta.main) {
  const client = makeClient();

  if (Deno.args.includes("--clean")) {
    const entries = cleanOrder(REGISTRY);
    for (const entry of entries) {
      if (!hasSeedPrefixFilter(entry.match)) fail(entry.table, "refusing --clean: no seed-prefix like filter");
    }
    for (const entry of entries) {
      const { error } = await applyFilters(client.from(entry.table).delete(), entry.match);
      if (error) fail(entry.table, error.message);
    }
  } else {
    for (const entry of REGISTRY) {
      const { error } = await client
        .from(entry.table)
        .upsert(entry.rows, { onConflict: entry.conflict, ignoreDuplicates: true, defaultToNull: false });
      if (error) fail(entry.table, error.message);
    }
  }

  for (const entry of REGISTRY) {
    console.log(`${entry.table}: ${await countRows(client, entry)} seed rows`);
  }
}
