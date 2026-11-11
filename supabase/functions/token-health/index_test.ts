import { assertEquals } from "jsr:@std/assert@1.0.6";
import { type Deps, handle } from "./handler.ts";

// Graph stub: p-ok answers, p-dead returns OAuthException 190, p-busy is rate limited.
const graphFetch: typeof fetch = (input) => {
  const token = new URL(String(input)).searchParams.get("access_token");
  if (token === "tok-ok") return Promise.resolve(Response.json({ id: "p-ok" }));
  const code = token === "tok-dead" ? 190 : 4;
  return Promise.resolve(Response.json({ error: { message: "nope", code } }, { status: 400 }));
};

function deps(pages = ["p-ok", "p-dead", "p-busy", "p-gone"]) {
  const records: [string, boolean][] = [];
  const tokens: Record<string, string> = { "p-ok": "tok-ok", "p-dead": "tok-dead", "p-busy": "tok-busy" };
  const d: Deps = {
    secretOk: (s) => Promise.resolve(s === "cron-secret"),
    connectedPages: () => Promise.resolve(pages),
    getPageToken: (id) => Promise.resolve(tokens[id] ?? null),
    record: (id, valid) => {
      records.push([id, valid]);
      return Promise.resolve();
    },
    fetch: graphFetch,
  };
  return { d, records };
}

function post(secret: string | null) {
  const headers: Record<string, string> = {};
  if (secret) headers["x-cron-secret"] = secret;
  return new Request("http://localhost/token-health", { method: "POST", headers, body: "{}" });
}

Deno.test("rejects a missing or wrong secret without checking Pages", async () => {
  for (const secret of [null, "wrong"]) {
    const { d, records } = deps();
    assertEquals((await handle(post(secret), d)).status, 403);
    assertEquals(records, []);
  }
});

Deno.test("rejects GET", async () => {
  assertEquals((await handle(new Request("http://localhost/token-health"), deps().d)).status, 405);
});

Deno.test("marks 190 invalid, valid tokens valid, and leaves rate-limited Pages alone", async () => {
  const { d, records } = deps();
  const res = await handle(post("cron-secret"), d);
  assertEquals(await res.json(), { checked: 2, invalid: 1, skipped: 1 });
  assertEquals(records, [["p-ok", true], ["p-dead", false]]);
});

Deno.test("no connected Pages is a no-op", async () => {
  const { d, records } = deps([]);
  assertEquals(await (await handle(post("cron-secret"), d)).json(), { checked: 0, invalid: 0, skipped: 0 });
  assertEquals(records, []);
});
