// Dataset tab "Test connection" for the embedding model: POST with the admin's Supabase session token.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { loadEmbedding } from "../_shared/ai/config.ts";
import { embed } from "../_shared/ai/embed.ts";
import { withCors } from "../_shared/cors.ts";
import { handle } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(withCors((req) =>
  handle(req, {
    getUser: async (token) => (await db.auth.getUser(token)).data.user,
    loadEmbedding: () => loadEmbedding(db),
    embed,
  })
));
