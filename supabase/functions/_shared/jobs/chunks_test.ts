import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.6";
import { CHUNK_CHARS, chunks, contentHash, MAX_CHUNKS } from "./chunks.ts";

const job = { title: "Bảo vệ", company_name: "A Co", location: "Hà Nội", salary: null, employment_type: "Full-time", description_text: null };

Deno.test("a job without a description is one header chunk without empty fields", () => {
  assertEquals(chunks(job), ["Bảo vệ\nCông ty: A Co\nĐịa điểm: Hà Nội\nLoại hình: Full-time"]);
});

Deno.test("long descriptions split at whitespace, each chunk repeats the header, capped", () => {
  const word = "trực ca đêm ";
  const parts = chunks({ ...job, description_text: word.repeat(1_000) });
  assertEquals(parts.length, MAX_CHUNKS);
  for (const p of parts) {
    assert(p.startsWith("Bảo vệ\nCông ty: A Co"));
    const body = p.split("\n\n")[1];
    assert(body.length <= CHUNK_CHARS);
    // No word is cut in half.
    assert(body.split(" ").every((w) => ["trực", "ca", "đêm"].includes(w)));
  }
  assertEquals(chunks({ ...job, description_text: "ngắn" }).length, 1);
});

Deno.test("content hash changes with the model and the text", async () => {
  const a = await contentHash("m1", "x");
  assertEquals(a, await contentHash("m1", "x"));
  assertNotEquals(a, await contentHash("m2", "x"));
  assertNotEquals(a, await contentHash("m1", "y"));
  assertEquals(a.length, 64);
});
