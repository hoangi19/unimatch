// Chatbot tab "Test connection": POST {kind} with the admin's Supabase session token.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { chat } from "../_shared/ai/chat.ts";
import { loadProvider } from "../_shared/ai/config.ts";
import { handle } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve((req) =>
  handle(req, {
    getUser: async (token) => (await db.auth.getUser(token)).data.user,
    loadProvider: (kind) => loadProvider(db, kind),
    chat,
  })
);
