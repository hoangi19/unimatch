// Page token health check. Only pg_cron calls this; it authenticates with x-cron-secret.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handle } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve((req) =>
  handle(req, {
    secretOk: async (secret) => check(await db.rpc("token_health_secret_ok", { p_secret: secret })) === true,
    connectedPages: async () =>
      (check(await db.from("pages").select("id").not("access_token_secret_id", "is", null)) ?? []).map((p) => p.id),
    getPageToken: async (pageId) => check(await db.rpc("get_page_token", { p_page_id: pageId })) as string | null,
    record: async (pageId, valid) => {
      check(await db.rpc("record_token_check", { p_page_id: pageId, p_valid: valid }));
    },
    fetch,
  })
);
