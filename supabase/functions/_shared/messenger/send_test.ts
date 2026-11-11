import { assert, assertEquals } from "jsr:@std/assert@1.0.6";
import { GRAPH_VERSION } from "../graph.ts";
import { classifyGraphError, type Deps, type OutboundRow, sendText } from "./send.ts";

const NOW = new Date("2026-11-12T12:00:00Z");
const TOKEN = "page-token-placeholder";

type Call = { url: string; init: RequestInit };

function deps(reply: () => Promise<Response> | Response, overrides: Partial<Deps> = {}) {
  const calls: Call[] = [];
  const rows: OutboundRow[] = [];
  const marked: string[] = [];
  const d: Deps = {
    fetch: (url, init) => {
      calls.push({ url: String(url), init: init! });
      return Promise.resolve(reply());
    },
    now: () => NOW,
    findConversation: (pageId, psid) =>
      Promise.resolve(pageId === "p1" && psid === "u1" ? { id: "c1", lastCustomerMessageAt: "2026-11-12T00:00:00Z" } : null),
    getPageToken: () => Promise.resolve(TOKEN),
    record: (row) => {
      rows.push(row);
      return Promise.resolve(`row-${rows.length}`);
    },
    markTokenInvalid: (pageId) => {
      marked.push(pageId);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { d, calls, rows, marked };
}

const ok = () => Response.json({ recipient_id: "u1", message_id: "m_1" });
const graphError = (code: number, sub?: number, status = 400) =>
  () => Response.json({ error: { message: `secret-free text ${TOKEN}`, code, error_subcode: sub } }, { status });

Deno.test("bot send posts a RESPONSE with the token in a header and stores the mid", async () => {
  const { d, calls, rows } = deps(ok);
  const res = await sendText(d, "p1", "u1", "hello", { kind: "bot", trace: { model: "x" } });
  assertEquals(res, { ok: true, messageId: "row-1", externalId: "m_1" });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`);
  assert(!calls[0].url.includes(TOKEN));
  assertEquals((calls[0].init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
  assertEquals(JSON.parse(calls[0].init.body as string), {
    recipient: { id: "u1" },
    messaging_type: "RESPONSE",
    message: { text: "hello" },
  });
  assertEquals(rows, [{ conversationId: "c1", sender: { kind: "bot", trace: { model: "x" } }, text: "hello", externalId: "m_1", deliveryError: null }]);
});

Deno.test("admin send stores the admin id", async () => {
  const { d, rows } = deps(ok);
  await sendText(d, "p1", "u1", "hi", { kind: "admin", adminId: "a1" });
  assertEquals(rows[0].sender, { kind: "admin", adminId: "a1" });
});

Deno.test("unknown conversation is not_found and calls nothing", async () => {
  const { d, calls, rows } = deps(ok);
  const res = await sendText(d, "p1", "u2", "hi", { kind: "bot" });
  assertEquals(res.ok ? null : res.error.kind, "not_found");
  assertEquals([calls.length, rows.length], [0, 0]);
});

Deno.test("24h window: just inside sends, at 24h or with no customer message is outside_window", async () => {
  const at = (iso: string | null) => ({
    findConversation: () => Promise.resolve({ id: "c1", lastCustomerMessageAt: iso }),
  });
  const inside = deps(ok, at("2026-11-11T12:00:01Z"));
  assert((await sendText(inside.d, "p1", "u1", "hi", { kind: "bot" })).ok);
  for (const iso of ["2026-11-11T12:00:00Z", "2026-11-01T00:00:00Z", null]) {
    const { d, calls, rows } = deps(ok, at(iso));
    const res = await sendText(d, "p1", "u1", "hi", { kind: "bot" });
    assertEquals(res.ok ? null : res.error.kind, "outside_window", String(iso));
    assertEquals([calls.length, rows.length], [0, 0]);
  }
});

Deno.test("Graph errors map to kinds, store a failed row without Graph text or token", async () => {
  const cases: [number, number | undefined, string][] = [
    [190, 463, "token_invalid"],
    [102, undefined, "token_invalid"],
    [4, undefined, "rate_limit"],
    [613, undefined, "rate_limit"],
    [551, 1545041, "user_unavailable"],
    [100, 2018001, "user_unavailable"],
    [10, 2018278, "outside_window"],
    [100, 33, "send_failed"],
  ];
  for (const [code, sub, kind] of cases) {
    const { d, rows, marked } = deps(graphError(code, sub));
    const res = await sendText(d, "p1", "u1", "hi", { kind: "bot" });
    assert(!res.ok);
    assertEquals(res.error.kind, kind, `${code}/${sub}`);
    assertEquals(res.messageId, "row-1");
    assertEquals(rows[0].externalId, null);
    assertEquals(rows[0].deliveryError, res.error.message);
    assert(res.error.message.includes(String(code)));
    assert(!res.error.message.includes(TOKEN) && !res.error.message.includes("secret-free"));
    assertEquals(marked, kind === "token_invalid" ? ["p1"] : []);
  }
});

Deno.test("no saved token is token_invalid without calling Graph", async () => {
  const { d, calls, rows, marked } = deps(ok, { getPageToken: () => Promise.resolve(null) });
  const res = await sendText(d, "p1", "u1", "hi", { kind: "bot" });
  assertEquals(res.ok ? null : res.error.kind, "token_invalid");
  assertEquals([calls.length, rows.length, marked.length], [0, 1, 1]);
});

Deno.test("network error and non-JSON responses are send_failed", async () => {
  const down = deps(() => Promise.reject(new TypeError("connection refused")));
  const r1 = await sendText(down.d, "p1", "u1", "hi", { kind: "bot" });
  assertEquals(r1.ok ? null : r1.error.kind, "send_failed");
  const html = deps(() => new Response("<html>bad gateway</html>", { status: 502 }));
  const r2 = await sendText(html.d, "p1", "u1", "hi", { kind: "bot" });
  assertEquals(r2.ok ? null : r2.error.message, "Messenger did not accept the message (HTTP 502)");
});

Deno.test("a store failure after Meta accepted the message still reports ok", async () => {
  const { d } = deps(ok, { record: () => Promise.reject(new Error("db down")) });
  assertEquals(await sendText(d, "p1", "u1", "hi", { kind: "bot" }), { ok: true, messageId: null, externalId: "m_1" });
});

Deno.test("classifyGraphError without an error object", () => {
  assertEquals(classifyGraphError(undefined), { kind: "send_failed", message: "Messenger did not accept the message" });
});
