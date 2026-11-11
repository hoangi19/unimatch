// Hourly Page token check, called by pg_cron (see the page_token_health migration) with x-cron-secret.
import { graph, MetaError } from "../_shared/meta.ts";

export type Deps = {
  secretOk(secret: string): Promise<boolean>;
  // Ids of Pages that have a stored token.
  connectedPages(): Promise<string[]>;
  getPageToken(pageId: string): Promise<string | null>;
  record(pageId: string, valid: boolean): Promise<void>;
  fetch: typeof fetch;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  const secret = req.headers.get("x-cron-secret");
  if (!secret || !(await deps.secretOk(secret))) return json({ error: "Forbidden" }, 403);

  let checked = 0, invalid = 0, skipped = 0;
  for (const pageId of await deps.connectedPages()) {
    try {
      const token = await deps.getPageToken(pageId);
      if (!token) continue;
      // Cheapest call that needs a working Page token; code 190 means expired or revoked.
      const valid = await graph("me", { fields: "id", access_token: token }, "GET", deps.fetch).then(
        () => true,
        (e) => {
          if (e instanceof MetaError && e.kind === "token_expired") return false;
          throw e;
        },
      );
      await deps.record(pageId, valid);
      checked++;
      if (!valid) invalid++;
    } catch (e) {
      // Rate limits and outages say nothing about the token: keep the Page as it is.
      skipped++;
      console.error("token-health: check failed", pageId, e instanceof Error ? e.message : "unknown error");
    }
  }
  return json({ checked, invalid, skipped });
}
