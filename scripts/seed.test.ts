import { assertEquals, assert } from "jsr:@std/assert@1.0.6";
import { cleanOrder, hasSeedPrefixFilter, REGISTRY, rowMatches, SEED_MATCH } from "./seed_registry.ts";

Deno.test("every registry entry has a seed-prefix like filter so --clean only deletes seed rows", () => {
  for (const entry of REGISTRY) {
    assert(hasSeedPrefixFilter(entry.match), `${entry.table} has no seed-prefix like filter`);
  }
});

Deno.test("an eq filter alone is not a seed-prefix filter", () => {
  assertEquals(hasSeedPrefixFilter([{ column: "page_id", op: "eq", value: "seed-demo" }]), false);
});

Deno.test("every seed row matches its entry filters so --clean removes it", () => {
  for (const entry of REGISTRY) {
    for (const row of entry.rows) {
      assert(rowMatches(row, entry.match), `${entry.table} seed row not matched by its filters`);
    }
  }
});

Deno.test("every seed row carries the entry's conflict column", () => {
  for (const entry of REGISTRY) {
    for (const row of entry.rows) {
      assert(entry.conflict in row, `${entry.table} row missing ${entry.conflict}`);
    }
  }
});

Deno.test("real rows are not matched by the seed filters", () => {
  assertEquals(rowMatches({ page_id: "1531275346725506", external_id: "seed:1" }, SEED_MATCH), false);
  assertEquals(rowMatches({ page_id: "seed-demo", external_id: "m_abc" }, SEED_MATCH), false);
});

Deno.test("like filter treats only % as a wildcard", () => {
  const filters = [{ column: "external_id", op: "like" as const, value: "a.b%" }];
  assertEquals(rowMatches({ external_id: "a.bc" }, filters), true);
  assertEquals(rowMatches({ external_id: "axbc" }, filters), false);
});

Deno.test("cleanOrder reverses the registry without mutating it", () => {
  const original = [...REGISTRY];
  const reversed = cleanOrder(REGISTRY);
  assertEquals(reversed, [...REGISTRY].reverse());
  assertEquals(REGISTRY, original);
});
