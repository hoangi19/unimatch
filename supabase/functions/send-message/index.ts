// Inbox manual reply: an admin sends a text to a customer through the Page.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { messengerDeps } from "../_shared/messenger/db.ts";
import { sendText } from "../_shared/messenger/send.ts";
import { handle } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const messenger = messengerDeps(db);

const failedAdmin = <Q extends { eq(column: string, value: string): Q }>(query: Q, id: string, conversationId: string) =>
  query.eq("id", id).eq("conversation_id", conversationId).eq("sender_kind", "admin").eq("delivery_status", "failed");

Deno.serve((req) =>
  handle(req, {
    getUser: async (token) => (await db.auth.getUser(token)).data.user,
    findConversation: async (id) => {
      const { data, error } = await db.from("conversations").select("page_id, psid").eq("id", id).maybeSingle();
      if (error) throw new Error("could not load the conversation");
      return data && { pageId: data.page_id, psid: data.psid };
    },
    sendText: (pageId, psid, text, sender) => sendText(messenger, pageId, psid, text, sender),
    takeOver: async (conversationId, adminId) => {
      const { error } = await db.rpc("set_conversation_mode_as", {
        p_conversation_id: conversationId, p_mode: "human", p_admin_id: adminId,
      });
      if (error) throw new Error(error.message);
    },
    isFailedAdminMessage: async (id, conversationId) => {
      const { data, error } = await failedAdmin(db.from("messages").select("id"), id, conversationId).maybeSingle();
      if (error) throw new Error("could not load the retried message");
      return data !== null;
    },
    deleteFailedAdminMessage: async (id, conversationId) => {
      const { error } = await failedAdmin(db.from("messages").delete(), id, conversationId);
      if (error) throw new Error(error.message);
    },
  })
);
