// Messenger webhook: verify handshake (GET), check signature and store events (POST).
// A trigger on webhook_events maps each stored event into conversations and messages;
// the reply engine then runs in the background so Meta gets its 200 right away.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { botDeps } from "../_shared/bot/db.ts";
import { runBot } from "../_shared/bot/engine.ts";
import { type Deps, handler } from "./handler.ts";

// Supabase runtime global: keeps the worker alive for background work after the response is sent.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const bot = botDeps(db);
const deps: Deps = {
  verifyToken: Deno.env.get("META_VERIFY_TOKEN")!,
  appSecret: Deno.env.get("META_APP_SECRET")!,
  store: async (rows) =>
    (await db.from("webhook_events").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true })).error?.message ?? null,
  onUserMessages: (targets) => {
    for (const t of targets) EdgeRuntime.waitUntil(runBot(bot, t.pageId, t.psid, t.at));
  },
};
Deno.serve((req) => handler(req, deps));
