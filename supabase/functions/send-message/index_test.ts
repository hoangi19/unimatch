import { assertEquals } from "jsr:@std/assert@1.0.6";
import type { Sender, SendResult } from "../_shared/messenger/send.ts";
import { type Deps, handle } from "./handler.ts";

const CONV = "00000000-0000-4000-8000-000000000001";

function deps(result: SendResult = { ok: true, messageId: "row-1", externalId: "m_1" }) {
  const sends: [string, string, string, Sender][] = [];
  const d: Deps = {
    getUser: (token) =>
      Promise.resolve(
        token === "admin-token"
          ? { id: "admin-1", app_metadata: { role: "admin" } }
          : token === "user-token"
          ? { id: "user-1", app_metadata: {} }
          : null,
      ),
    findConversation: (id) => Promise.resolve(id === CONV ? { pageId: "p1", psid: "u1" } : null),
    sendText: (pageId, psid, text, sender) => {
      sends.push([pageId, psid, text, sender]);
      return Promise.resolve(result);
    },
  };
  return { d, sends };
}

function post(token: string | null, body: unknown = { conversation_id: CONV, text: " hello " }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/send-message", { method: "POST", headers, body: JSON.stringify(body) });
}

Deno.test("OPTIONS answers CORS", async () => {
  const res = await handle(new Request("http://localhost/send-message", { method: "OPTIONS" }), deps().d);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});

Deno.test("no token, bad token and non-admin never send", async () => {
  for (const [token, status] of [[null, 401], ["forged", 401], ["user-token", 403]] as const) {
    const { d, sends } = deps();
    assertEquals((await handle(post(token), d)).status, status);
    assertEquals(sends.length, 0);
  }
});

Deno.test("bad input is 400", async () => {
  for (const body of [{ conversation_id: "x", text: "hi" }, { conversation_id: CONV, text: "   " }, { conversation_id: CONV, text: "a".repeat(2001) }, null]) {
    const { d, sends } = deps();
    assertEquals((await handle(post("admin-token", body), d)).status, 400);
    assertEquals(sends.length, 0);
  }
});

Deno.test("unknown conversation is 404", async () => {
  const res = await handle(post("admin-token", { conversation_id: "00000000-0000-4000-8000-000000000002", text: "hi" }), deps().d);
  assertEquals(res.status, 404);
});

Deno.test("admin sends trimmed text as themselves", async () => {
  const { d, sends } = deps();
  const res = await handle(post("admin-token"), d);
  assertEquals(await res.json(), { ok: true, message_id: "row-1" });
  assertEquals(sends, [["p1", "u1", "hello", { kind: "admin", adminId: "admin-1" }]]);
});

Deno.test("a typed send error comes back with the failed row id", async () => {
  const error = { kind: "outside_window" as const, message: "The customer's last message is older than 24 hours" };
  const res = await handle(post("admin-token"), deps({ ok: false, error }).d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: false, message_id: null, error });
});
