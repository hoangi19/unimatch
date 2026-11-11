// Messenger webhook: verify handshake (GET), check signature and store events (POST).
// A trigger on webhook_events maps each stored event into conversations and messages.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { type Deps, handler } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const deps: Deps = {
  verifyToken: Deno.env.get("META_VERIFY_TOKEN")!,
  appSecret: Deno.env.get("META_APP_SECRET")!,
  store: async (rows) =>
    (await db.from("webhook_events").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true })).error?.message ?? null,
};
Deno.serve((req) => handler(req, deps));
