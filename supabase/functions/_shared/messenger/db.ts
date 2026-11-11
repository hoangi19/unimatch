// Supabase adapter for sendText. `db` must be the service-role client.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import type { Deps } from "./send.ts";

export function messengerDeps(db: SupabaseClient): Deps {
  return {
    fetch,
    now: () => new Date(),
    findConversation: async (pageId, psid) => {
      const { data, error } = await db
        .from("conversations")
        .select("id, last_customer_message_at")
        .eq("page_id", pageId)
        .eq("psid", psid)
        .maybeSingle();
      if (error) throw new Error("could not load the conversation");
      return data && { id: data.id, lastCustomerMessageAt: data.last_customer_message_at };
    },
    getPageToken: async (pageId) => {
      const { data, error } = await db.rpc("get_page_token", { p_page_id: pageId });
      if (error) throw new Error("could not read the Page token");
      return data;
    },
    record: async (row) => {
      const { data, error } = await db.rpc("record_outbound_message", {
        p_conversation_id: row.conversationId,
        p_sender_kind: row.sender.kind,
        p_admin_id: row.sender.kind === "admin" ? row.sender.adminId : null,
        p_text: row.text,
        p_external_id: row.externalId,
        p_delivery_error: row.deliveryError,
        p_trace: row.sender.kind === "bot" ? row.sender.trace ?? null : null,
      });
      if (error) throw new Error(`could not store the message: ${error.message}`);
      return data;
    },
    // An expiry in the past is how the console knows to ask for a Page reconnect.
    markTokenInvalid: async (pageId) => {
      const { error } = await db.from("pages").update({ token_expires_at: new Date().toISOString() }).eq("id", pageId);
      if (error) console.error("messenger: could not mark the Page token invalid", error.message);
    },
  };
}
