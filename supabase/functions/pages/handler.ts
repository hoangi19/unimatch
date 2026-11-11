// Admin-only Page connection: list the admin's Facebook Pages, connect one, or disconnect one.
// The browser sends the short-lived user token from Facebook Login; no token is ever sent back.
import { graph, META_APP_ID, MetaError, type MetaErrorKind } from "../_shared/meta.ts";

export const SUBSCRIBED_FIELDS = "messages,messaging_postbacks,message_echoes,message_deliveries,message_reads";
// Either task lets the Page token read and send messages; MANAGE is not required.
export const REQUIRED_TASKS = ["MESSAGING", "MODERATE"];

export type PagesErrorKind = MetaErrorKind | "no_pages" | "not_found" | "missing_task";
export type PageSummary = { id: string; name: string; pictureUrl: string | null; tasks: string[] };

export type Deps = {
  // Verifies the token with Supabase Auth; null when missing, expired or invalid.
  getUser(token: string): Promise<{ app_metadata?: Record<string, unknown> } | null>;
  appSecret: string | undefined;
  fetch: typeof fetch;
  upsertPage(row: { id: string; name: string; picture_url: string | null }): Promise<void>;
  setPageToken(pageId: string, token: string, expiresAt: string | null): Promise<void>;
  replayWebhookEvents(pageId: string): Promise<number>;
  getPageToken(pageId: string): Promise<string | null>;
  clearPageToken(pageId: string): Promise<void>;
};

type Account = { id: string; name: string; access_token?: string; tasks?: string[]; picture?: { data?: { url?: string } } };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

class PagesError extends Error {
  constructor(readonly kind: PagesErrorKind, message: string) {
    super(message);
  }
}

// Long-lived user token (about 60 days). Page tokens read with it do not expire.
async function exchange(userToken: string, deps: Deps): Promise<string> {
  if (!deps.appSecret) throw new PagesError("bad_config", "META_APP_SECRET is not set");
  const res = await graph<{ access_token: string }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: META_APP_ID,
    client_secret: deps.appSecret,
    fb_exchange_token: userToken,
  }, "GET", deps.fetch);
  return res.access_token;
}

async function accounts(userToken: string, deps: Deps): Promise<Account[]> {
  const longLived = await exchange(userToken, deps);
  const res = await graph<{ data?: Account[] }>("me/accounts", {
    fields: "id,name,picture{url},tasks,access_token",
    limit: "100",
    access_token: longLived,
  }, "GET", deps.fetch);
  if (!res.data?.length) throw new PagesError("no_pages", "No Facebook Pages were shared with the app");
  return res.data;
}

const summary = (a: Account): PageSummary => ({
  id: a.id,
  name: a.name,
  pictureUrl: a.picture?.data?.url ?? null,
  tasks: a.tasks ?? [],
});

async function list(userToken: string, deps: Deps) {
  return { pages: (await accounts(userToken, deps)).map(summary) };
}

async function connect(userToken: string, pageId: string, deps: Deps) {
  const page = (await accounts(userToken, deps)).find((a) => a.id === pageId);
  if (!page) throw new PagesError("not_found", "This Page was not shared with the app");
  if (!page.tasks?.some((t) => REQUIRED_TASKS.includes(t))) {
    throw new PagesError("missing_task", "You need the Messaging or Moderate task on this Page");
  }
  if (!page.access_token) throw new PagesError("permission_denied", "Facebook did not return a Page token");

  // Subscribe first: if a later step fails, events are still held and replayed on the next connect.
  await graph(pageId + "/subscribed_apps", { subscribed_fields: SUBSCRIBED_FIELDS, access_token: page.access_token }, "POST", deps.fetch);
  await deps.upsertPage({ id: page.id, name: page.name, picture_url: page.picture?.data?.url ?? null });
  await deps.setPageToken(page.id, page.access_token, null);
  const replayed = await deps.replayWebhookEvents(page.id);
  return { page: summary(page), replayed };
}

async function disconnect(pageId: string, deps: Deps) {
  const token = await deps.getPageToken(pageId);
  if (token) {
    try {
      await graph(pageId + "/subscribed_apps", { access_token: token }, "DELETE", deps.fetch);
    } catch (e) {
      // An expired or revoked token must not block disconnecting.
      if (!(e instanceof MetaError)) throw e;
      console.warn("unsubscribe failed", e.kind);
    }
  }
  await deps.clearPageToken(pageId);
  return {};
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const user = token ? await deps.getUser(token) : null;
  if (!user) return json({ error: "Sign in required" }, 401);
  if (user.app_metadata?.role !== "admin") return json({ error: "Admin only" }, 403);

  const body = await req.json().catch(() => null);
  const userToken = typeof body?.userToken === "string" && body.userToken ? body.userToken : null;
  const pageId = typeof body?.pageId === "string" && /^\d+$/.test(body.pageId) ? body.pageId : null;

  try {
    if (body?.action === "list" && userToken) return json({ ok: true, ...await list(userToken, deps) });
    if (body?.action === "connect" && userToken && pageId) return json({ ok: true, ...await connect(userToken, pageId, deps) });
    if (body?.action === "disconnect" && pageId) return json({ ok: true, ...await disconnect(pageId, deps) });
    return json({ error: "Bad request" }, 400);
  } catch (e) {
    if (e instanceof PagesError || e instanceof MetaError) return json({ ok: false, error: { kind: e.kind, message: e.message } });
    console.error("pages failed", e instanceof Error ? e.message : "unknown error");
    return json({ ok: false, error: { kind: "graph", message: "Unexpected error" } }, 500);
  }
}
