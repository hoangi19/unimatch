// Inbox manual reply: an admin sends a text to a customer through the Page.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { messengerDeps } from "../_shared/messenger/db.ts";
import { sendText } from "../_shared/messenger/send.ts";
import { handle } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const messenger = messengerDeps(db);

Deno.serve((req) =>
  handle(req, {
    getUser: async (token) => (await db.auth.getUser(token)).data.user,
    findConversation: async (id) => {
      const { data, error } = await db.from("conversations").select("page_id, psid").eq("id", id).maybeSingle();
      if (error) throw new Error("could not load the conversation");
      return data && { pageId: data.page_id, psid: data.psid };
    },
    sendText: (pageId, psid, text, sender) => sendText(messenger, pageId, psid, text, sender),
  })
);
