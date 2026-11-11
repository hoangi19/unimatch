// Messenger webhook: verify handshake (GET), check signature and store events (POST).
// A trigger on webhook_events maps each stored event into conversations and messages;
// the reply engine and the customer profile lookup then run in the background so Meta gets its 200 right away.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { botDeps } from "../_shared/bot/db.ts";
import { runBot } from "../_shared/bot/engine.ts";
import { graph } from "../_shared/meta.ts";
import { type Deps, handler } from "./handler.ts";
import { type Deps as ProfileDeps, type Profile, refreshProfile } from "./profile.ts";

// Supabase runtime global: keeps the worker alive for background work after the response is sent.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const bot = botDeps(db);
const profile: ProfileDeps = {
  claim: async (pageId, psid) => {
    const { data, error } = await db.rpc("claim_customer_profile", { p_page_id: pageId, p_psid: psid });
    if (error) throw new Error(`could not claim the profile lookup: ${error.message}`);
    return data === true;
  },
  getPageToken: async (pageId) => {
    const { data, error } = await db.rpc("get_page_token", { p_page_id: pageId });
    if (error) throw new Error("could not read the Page token");
    return data;
  },
  fetchProfile: (psid, token) => graph<Profile>(psid, { fields: "name,profile_pic", access_token: token }),
  save: async (pageId, psid, name, pictureUrl) => {
    const { error } = await db.from("conversations").update({ customer_name: name, customer_picture_url: pictureUrl })
      .eq("page_id", pageId).eq("psid", psid);
    if (error) throw new Error(`could not save the profile: ${error.message}`);
  },
};
const deps: Deps = {
  verifyToken: Deno.env.get("META_VERIFY_TOKEN")!,
  appSecret: Deno.env.get("META_APP_SECRET")!,
  store: async (rows) =>
    (await db.from("webhook_events").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true })).error?.message ?? null,
  onUserMessages: (targets) => {
    for (const t of targets) {
      EdgeRuntime.waitUntil(runBot(bot, t.pageId, t.psid, t.at));
      EdgeRuntime.waitUntil(refreshProfile(profile, t.pageId, t.psid));
    }
  },
};
Deno.serve((req) => handler(req, deps));
