import { assert, assertEquals } from "jsr:@std/assert@1.0.6";
import { GRAPH_VERSION } from "../_shared/graph.ts";
import { type Deps, handle, SUBSCRIBED_FIELDS } from "./handler.ts";

const USER_TOKEN = "short-user-token";
const LONG_TOKEN = "long-user-token";
const PAGE_TOKEN = "page-token-1531";

// The real UniMatch Page: no MANAGE task.
const UNIMATCH = {
  id: "1531275346725506",
  name: "UniMatch",
  access_token: PAGE_TOKEN,
  tasks: ["MODERATE", "MESSAGING", "ANALYZE", "ADVERTISE", "CREATE_CONTENT"],
  picture: { data: { url: "https://example.com/p.jpg" } },
};

type Call = { method: string; path: string; params: URLSearchParams };

function graphError(code: number, status = 400) {
  return Response.json({ error: { message: `error ${code}`, code } }, { status });
}

function deps(routes: Record<string, () => Response> = {}, overrides: Partial<Deps> = {}) {
  const calls: Call[] = [];
  const log: string[] = [];
  const defaults: Record<string, () => Response> = {
    "GET oauth/access_token": () => Response.json({ access_token: LONG_TOKEN, token_type: "bearer", expires_in: 5183944 }),
    "GET me/accounts": () => Response.json({ data: [UNIMATCH] }),
    [`POST ${UNIMATCH.id}/subscribed_apps`]: () => Response.json({ success: true }),
    [`DELETE ${UNIMATCH.id}/subscribed_apps`]: () => Response.json({ success: true }),
  };
  const d: Deps = {
    getUser: (token) => Promise.resolve(token === "admin-token" ? { app_metadata: { role: "admin" } } : token === "user-token" ? { app_metadata: {} } : null),
    appSecret: "app-secret",
    fetch: (input, init) => {
      const url = new URL(input as URL);
      const method = init?.method ?? "GET";
      const path = url.pathname.replace(`/${GRAPH_VERSION}/`, "");
      const params = method === "POST" ? new URLSearchParams(init?.body as URLSearchParams) : url.searchParams;
      calls.push({ method, path, params });
      log.push(`${method} ${path}`);
      const route = routes[`${method} ${path}`] ?? defaults[`${method} ${path}`];
      return Promise.resolve(route ? route() : new Response("not found", { status: 404 }));
    },
    upsertPage: (row) => (log.push(`upsert ${row.id} ${row.name} ${row.picture_url}`), Promise.resolve()),
    setPageToken: (id, token, expires) => (log.push(`setToken ${id} ${token} ${expires}`), Promise.resolve()),
    replayWebhookEvents: (id) => (log.push(`replay ${id}`), Promise.resolve(3)),
    getPageToken: (id) => (log.push(`getToken ${id}`), Promise.resolve(PAGE_TOKEN)),
    clearPageToken: (id) => (log.push(`clear ${id}`), Promise.resolve()),
    ...overrides,
  };
  return { d, calls, log };
}

function post(body: unknown, token: string | null = "admin-token") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/pages", { method: "POST", headers, body: JSON.stringify(body) });
}

Deno.test("no token, invalid token and non-admin never reach Facebook", async () => {
  for (const [token, status] of [[null, 401], ["forged", 401], ["user-token", 403]] as const) {
    const { d, calls } = deps();
    const res = await handle(post({ action: "list", userToken: USER_TOKEN }, token), d);
    assertEquals(res.status, status);
    assertEquals(calls.length, 0);
  }
});

Deno.test("bad bodies are 400", async () => {
  for (const body of [{}, { action: "list" }, { action: "connect", userToken: USER_TOKEN }, { action: "disconnect", pageId: "../me" }]) {
    assertEquals((await handle(post(body), deps().d)).status, 400);
  }
});

Deno.test("missing app secret is bad_config and nothing is called", async () => {
  const { d, calls } = deps({}, { appSecret: undefined });
  const res = await handle(post({ action: "connect", userToken: USER_TOKEN, pageId: UNIMATCH.id }), d);
  assertEquals((await res.json()).error.kind, "bad_config");
  assertEquals(calls.length, 0);
});

Deno.test("list exchanges the token and returns Pages without any token", async () => {
  const { d, calls } = deps();
  const res = await handle(post({ action: "list", userToken: USER_TOKEN }), d);
  const text = await res.text();
  assertEquals(JSON.parse(text), {
    ok: true,
    pages: [{ id: UNIMATCH.id, name: "UniMatch", pictureUrl: "https://example.com/p.jpg", tasks: UNIMATCH.tasks }],
  });
  for (const t of [USER_TOKEN, LONG_TOKEN, PAGE_TOKEN, "app-secret"]) assert(!text.includes(t), "response leaks a token");

  const [ex, acc] = calls;
  assertEquals(ex.params.get("grant_type"), "fb_exchange_token");
  assertEquals(ex.params.get("client_secret"), "app-secret");
  assertEquals(ex.params.get("fb_exchange_token"), USER_TOKEN);
  assertEquals(acc.params.get("access_token"), LONG_TOKEN);
  assert(acc.params.get("fields")!.includes("tasks"));
});

Deno.test("no Pages shared is no_pages", async () => {
  const { d } = deps({ "GET me/accounts": () => Response.json({ data: [] }) });
  assertEquals((await (await handle(post({ action: "list", userToken: USER_TOKEN }), d)).json()).error.kind, "no_pages");
});

Deno.test("an expired user token is token_expired", async () => {
  const { d } = deps({ "GET oauth/access_token": () => graphError(190) });
  const body = await (await handle(post({ action: "list", userToken: USER_TOKEN }), d)).json();
  assertEquals(body, { ok: false, error: { kind: "token_expired", message: "error 190" } });
});

Deno.test("a refused permission is permission_denied", async () => {
  const { d } = deps({ "GET me/accounts": () => graphError(200, 403) });
  assertEquals((await (await handle(post({ action: "list", userToken: USER_TOKEN }), d)).json()).error.kind, "permission_denied");
});

Deno.test("connect subscribes, stores the token, then replays held events", async () => {
  const { d, calls, log } = deps();
  const res = await handle(post({ action: "connect", userToken: USER_TOKEN, pageId: UNIMATCH.id }), d);
  const text = await res.text();
  assertEquals(JSON.parse(text).ok, true);
  assertEquals(JSON.parse(text).replayed, 3);
  assert(!text.includes(PAGE_TOKEN));
  assertEquals(log.slice(2), [
    `POST ${UNIMATCH.id}/subscribed_apps`,
    `upsert ${UNIMATCH.id} UniMatch https://example.com/p.jpg`,
    `setToken ${UNIMATCH.id} ${PAGE_TOKEN} null`,
    `replay ${UNIMATCH.id}`,
  ]);
  const sub = calls[2].params;
  assertEquals(sub.get("subscribed_fields"), SUBSCRIBED_FIELDS);
  assertEquals(sub.get("access_token"), PAGE_TOKEN);
});

Deno.test("connect needs Messaging or Moderate, not Manage", async () => {
  const { d, log } = deps({ "GET me/accounts": () => Response.json({ data: [{ ...UNIMATCH, tasks: ["ANALYZE"] }] }) });
  const body = await (await handle(post({ action: "connect", userToken: USER_TOKEN, pageId: UNIMATCH.id }), d)).json();
  assertEquals(body.error.kind, "missing_task");
  assertEquals(log.length, 2);
});

Deno.test("connecting a Page not shared with the app is not_found", async () => {
  const { d } = deps();
  const body = await (await handle(post({ action: "connect", userToken: USER_TOKEN, pageId: "999" }), d)).json();
  assertEquals(body.error.kind, "not_found");
});

Deno.test("a failed subscribe stores nothing", async () => {
  const { d, log } = deps({ [`POST ${UNIMATCH.id}/subscribed_apps`]: () => graphError(10, 403) });
  const body = await (await handle(post({ action: "connect", userToken: USER_TOKEN, pageId: UNIMATCH.id }), d)).json();
  assertEquals(body.error.kind, "permission_denied");
  assert(!log.some((l) => l.startsWith("upsert") || l.startsWith("setToken")));
});

Deno.test("a database failure is a 500 without details", async () => {
  const { d } = deps({}, { setPageToken: () => Promise.reject(new Error("db down")) });
  const res = await handle(post({ action: "connect", userToken: USER_TOKEN, pageId: UNIMATCH.id }), d);
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error.message, "Unexpected error");
});

Deno.test("disconnect unsubscribes then clears the token", async () => {
  const { d, log } = deps();
  const res = await handle(post({ action: "disconnect", pageId: UNIMATCH.id }), d);
  assertEquals(await res.json(), { ok: true });
  assertEquals(log, [`getToken ${UNIMATCH.id}`, `DELETE ${UNIMATCH.id}/subscribed_apps`, `clear ${UNIMATCH.id}`]);
});

Deno.test("disconnect still clears when the Page token has expired", async () => {
  const { d, log } = deps({ [`DELETE ${UNIMATCH.id}/subscribed_apps`]: () => graphError(190, 401) });
  assertEquals(await (await handle(post({ action: "disconnect", pageId: UNIMATCH.id }), d)).json(), { ok: true });
  assertEquals(log.at(-1), `clear ${UNIMATCH.id}`);
});

Deno.test("disconnect without a stored token skips Facebook", async () => {
  const { d, calls, log } = deps({}, { getPageToken: () => Promise.resolve(null) });
  await handle(post({ action: "disconnect", pageId: UNIMATCH.id }), d);
  assertEquals(calls.length, 0);
  assertEquals(log, [`clear ${UNIMATCH.id}`]);
});
