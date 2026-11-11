import { assertEquals } from "jsr:@std/assert@1.0.6";
import { type ExistingChunk, type JobText, plan } from "./embed-jobs.ts";

const job = (id: string, description: string | null = null): JobText => ({
  source: "linkedin",
  external_id: id,
  title: `Job ${id}`,
  company_name: "A Co",
  location: "Hà Nội",
  salary: null,
  employment_type: null,
  description_text: description,
});

// What the script would hold in job_chunks after embedding a plan.
const stored = (p: Awaited<ReturnType<typeof plan>>): ExistingChunk[] =>
  p.embed.map(({ text: _text, ...c }) => c);

Deno.test("first run embeds every chunk; a re-run with no changes embeds nothing", async () => {
  const jobs = [job("1"), job("2", "mô tả ".repeat(400))];
  const first = await plan(jobs, [], "m1");
  assertEquals(first.embed.length > jobs.length, true);
  assertEquals(first.skipped, 0);
  const again = await plan(jobs, stored(first), "m1");
  assertEquals(again.embed, []);
  assertEquals(again.skipped, first.embed.length);
  assertEquals(again.remove, []);
});

Deno.test("changed text or model re-embeds; a shorter description removes extra chunks", async () => {
  const first = await plan([job("1", "mô tả ".repeat(400))], [], "m1");
  const existing = stored(first);
  const changed = await plan([job("1", "ngắn")], existing, "m1");
  assertEquals(changed.embed.map((c) => c.chunk_index), [0]);
  assertEquals(changed.remove.map((c) => c.chunk_index), existing.slice(1).map((c) => c.chunk_index));
  const newModel = await plan([job("1", "mô tả ".repeat(400))], existing, "m2");
  assertEquals(newModel.embed.length, existing.length);
});
