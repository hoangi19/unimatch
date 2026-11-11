import { assert, assertEquals } from "jsr:@std/assert@1.0.6";
import { type JobRow, normalize } from "./import-jobs.ts";

const base = { id: "j1", source: "linkedin", title: "Sales intern" };

function row(record: Record<string, unknown>): JobRow {
  const result = normalize(record);
  assert("row" in result, `expected a row, got ${JSON.stringify(result)}`);
  return result.row;
}

Deno.test("the string null and empty strings become null", () => {
  const r = row({ ...base, companyName: "null", salary: "", location: "  ", industries: "IT" });
  assertEquals(r.company_name, null);
  assertEquals(r.salary, null);
  assertEquals(r.location, null);
  assertEquals(r.industries, "IT");
});

Deno.test("benefits accept an array or a JSON string and drop empty entries", () => {
  assertEquals(row({ ...base, benefits: ["Lunch", "null", ""] }).benefits, ["Lunch"]);
  assertEquals(row({ ...base, benefits: '["Lunch","Bonus"]' }).benefits, ["Lunch", "Bonus"]);
  assertEquals(row({ ...base, benefits: "null" }).benefits, []);
  assertEquals(row({ ...base, benefits: "Lunch" }).benefits, ["Lunch"]);
  assertEquals(row(base).benefits, []);
});

Deno.test("applicantsCount becomes an int from a number or digit string", () => {
  assertEquals(row({ ...base, applicantsCount: 12 }).applicants_count, 12);
  assertEquals(row({ ...base, applicantsCount: "42" }).applicants_count, 42);
  assertEquals(row({ ...base, applicantsCount: "over 100" }).applicants_count, null);
  assertEquals(row({ ...base, applicantsCount: "null" }).applicants_count, null);
});

Deno.test("postedAt keeps valid dates only; scrapedAt becomes UTC ISO", () => {
  assertEquals(row({ ...base, postedAt: "2026-10-13" }).posted_at, "2026-10-13");
  assertEquals(row({ ...base, postedAt: "2026-13-45" }).posted_at, null);
  assertEquals(row({ ...base, postedAt: "2026-02-30" }).posted_at, null);
  assertEquals(row({ ...base, postedAt: "2 days ago" }).posted_at, null);
  assertEquals(row({ ...base, scrapedAt: "2026-11-11T10:00:00+07:00" }).scraped_at, "2026-11-11T03:00:00.000Z");
  assertEquals(row({ ...base, scrapedAt: "garbage" }).scraped_at, null);
});

Deno.test("records without id, source or title are skipped with a reason", () => {
  assertEquals(normalize({ ...base, id: "null" }), { skip: "missing id" });
  assertEquals(normalize({ ...base, source: "" }), { skip: "missing source" });
  assertEquals(normalize({ ...base, source: "Bad Source" }), { skip: "invalid source" });
  assertEquals(normalize({ ...base, title: undefined }), { skip: "missing title" });
});

Deno.test("raw keeps the full original record and keys map to the primary key", () => {
  const record = { ...base, contact: "x", refId: "r" };
  const r = row(record);
  assertEquals(r.raw, record);
  assertEquals([r.source, r.external_id, r.title], ["linkedin", "j1", "Sales intern"]);
});
