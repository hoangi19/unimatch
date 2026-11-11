// Chatbot tab test chat: POST the draft settings + test history with the admin's Supabase session token.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { AiError, chat } from "../_shared/ai/chat.ts";
import { loadKey } from "../_shared/ai/config.ts";
import { assertPublicHost } from "../_shared/ai/host.ts";
import { searchJobs } from "../_shared/bot/db.ts";
import { withCors } from "../_shared/cors.ts";
import { handle } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(withCors((req) =>
  handle(req, {
    getUser: async (token) => (await db.auth.getUser(token)).data.user,
    loadBaseUrl: async (kind) => {
      const { data, error } = await db.from("ai_providers").select("base_url").eq("kind", kind).maybeSingle();
      if (error) throw new Error(`could not load provider ${kind}`);
      if (!data) throw new AiError("bad_config", `Unknown provider: ${kind}`);
      // Before the key is loaded, so a blocked host never gets it.
      if (data.base_url) await assertPublicHost(data.base_url);
      return data.base_url;
    },
    loadKey: (kind) => loadKey(db, kind),
    chat,
    searchJobs: (query, count) => searchJobs(db, query, count),
  })
));
