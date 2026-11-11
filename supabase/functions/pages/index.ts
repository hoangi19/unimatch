// Pages tab: POST {action: "list" | "connect" | "disconnect", userToken?, pageId?} with the admin's Supabase session token.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { withCors } from "../_shared/cors.ts";
import { handle } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Supabase errors never include the token argument; rethrow only their message.
function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(withCors((req) =>
  handle(req, {
    getUser: async (token) => (await db.auth.getUser(token)).data.user,
    appSecret: Deno.env.get("META_APP_SECRET"),
    fetch,
    upsertPage: async (row) => void check(await db.from("pages").upsert({ ...row, connected_at: new Date().toISOString() })),
    setPageToken: async (pageId, token, expiresAt) =>
      void check(await db.rpc("set_page_token", { p_page_id: pageId, p_token: token, p_expires_at: expiresAt })),
    replayWebhookEvents: async (pageId) => check(await db.rpc("replay_webhook_events", { p_page_id: pageId })) as number,
    getPageToken: async (pageId) => check(await db.rpc("get_page_token", { p_page_id: pageId })) as string | null,
    clearPageToken: async (pageId) => void check(await db.rpc("clear_page_token", { p_page_id: pageId })),
  })
));
