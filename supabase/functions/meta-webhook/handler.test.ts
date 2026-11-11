import { assert, assertEquals } from "jsr:@std/assert@1.0.6";
import { type Deps, handler, type Target, toRows, userTargets, validSignature } from "./handler.ts";

const SECRET = "test-app-secret";

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return "sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fakeDeps(error: string | null = null) {
  const stored: unknown[][] = [];
  const triggered: Target[][] = [];
  const deps: Deps = {
    onUserMessages: (targets) => triggered.push(targets),
    verifyToken: "test-verify",
    appSecret: SECRET,
    store: (rows) => {
      stored.push(rows);
      return Promise.resolve(error);
    },
  };
  return { deps, stored, triggered };
}

async function post(payload: unknown, deps: Deps, signature?: string | null): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers = new Headers();
  const sig = signature === undefined ? await sign(body) : signature;
  if (sig) headers.set("x-hub-signature-256", sig);
  return handler(new Request("http://localhost/meta-webhook", { method: "POST", body, headers }), deps);
}

const PAGE = "1531275346725506";
const userMessage = { sender: { id: "u1" }, recipient: { id: PAGE }, timestamp: 1767225600000, message: { mid: "m.1", text: "hi" } };
const echo = {
  sender: { id: PAGE }, recipient: { id: "u1" }, timestamp: 1767225601000,
  message: { mid: "m.2", text: "reply", is_echo: true, app_id: 1 },
};
const postback = { sender: { id: "u1" }, recipient: { id: PAGE }, timestamp: 1767225602000, postback: { mid: "m.3", title: "Go", payload: "GO" } };
const delivery = { sender: { id: "u1" }, recipient: { id: PAGE }, timestamp: 1767225603000, delivery: { mids: ["m.2"], watermark: 1767225601000 } };
const read = { sender: { id: "u1" }, recipient: { id: PAGE }, timestamp: 1767225604000, read: { watermark: 1767225601000 } };
const payload = { object: "page", entry: [{ id: PAGE, messaging: [userMessage, echo, postback, delivery, read] }] };

Deno.test("validSignature accepts the app secret's HMAC and rejects others", async () => {
  assert(await validSignature("body", await sign("body"), SECRET));
  assert(!(await validSignature("body", await sign("body", "other-secret"), SECRET)));
  assert(!(await validSignature("body", await sign("tampered"), SECRET)));
  assert(!(await validSignature("body", null, SECRET)));
  assert(!(await validSignature("body", "sha1=abc", SECRET)));
});

Deno.test("toRows maps each messaging item to a field and a stable external_id", () => {
  const rows = toRows(payload);
  assertEquals(rows.map((r) => [r.page_id, r.field, r.external_id]), [
    [PAGE, "messages", "m.1"],
    [PAGE, "messages", "m.2"],
    [PAGE, "messaging_postbacks", "m.3"],
    [PAGE, "delivery", `${PAGE}:u1:1767225603000:delivery`],
    [PAGE, "read", `${PAGE}:u1:1767225604000:read`],
  ]);
  assertEquals(rows[1].payload, echo);
});

Deno.test("POST with a valid signature stores every event once", async () => {
  const { deps, stored } = fakeDeps();
  const res = await post(payload, deps);
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "EVENT_RECEIVED");
  assertEquals(stored.length, 1);
  assertEquals(stored[0].length, 5);
});

Deno.test("POST with a bad or missing signature is rejected before storing", async () => {
  const { deps, stored } = fakeDeps();
  assertEquals((await post(payload, deps, await sign("other"))).status, 401);
  assertEquals((await post(payload, deps, null)).status, 401);
  assertEquals(stored.length, 0);
});

Deno.test("a store error returns 500 so Meta retries", async () => {
  const { deps } = fakeDeps("connection reset");
  assertEquals((await post(payload, deps)).status, 500);
});

Deno.test("non-page objects are acknowledged but not stored", async () => {
  const { deps, stored } = fakeDeps();
  const res = await post({ object: "user", entry: [] }, deps);
  assertEquals(await res.text(), "ignored");
  assertEquals(stored.length, 0);
});

Deno.test("GET verifies the subscribe handshake", async () => {
  const { deps } = fakeDeps();
  const url = "http://localhost/meta-webhook?hub.mode=subscribe&hub.challenge=42&hub.verify_token=";
  assertEquals(await (await handler(new Request(url + "test-verify"), deps)).text(), "42");
  assertEquals((await handler(new Request(url + "wrong"), deps)).status, 403);
});

Deno.test("userTargets keeps customer messages and postbacks, newest per conversation", () => {
  const later = { ...userMessage, timestamp: 1767225609000, message: { mid: "m.9", text: "more" } };
  const other = { ...userMessage, sender: { id: "u2" }, message: { mid: "m.8", text: "yo" } };
  const rows = toRows({ object: "page", entry: [{ id: PAGE, messaging: [userMessage, echo, postback, delivery, read, later, other] }] });
  assertEquals(userTargets(rows), [
    { pageId: PAGE, psid: "u1", at: 1767225609000 },
    { pageId: PAGE, psid: "u2", at: 1767225600000 },
  ]);
});

Deno.test("the reply engine is triggered only after a successful store", async () => {
  const ok = fakeDeps();
  await post(payload, ok.deps);
  assertEquals(ok.triggered, [[{ pageId: PAGE, psid: "u1", at: 1767225602000 }]]);

  const failed = fakeDeps("connection reset");
  await post(payload, failed.deps);
  assertEquals(failed.triggered.length, 0);

  const echoesOnly = fakeDeps();
  await post({ object: "page", entry: [{ id: PAGE, messaging: [echo, delivery] }] }, echoesOnly.deps);
  assertEquals(echoesOnly.triggered, [[]]);
});
