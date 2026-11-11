// Supabase adapter for the reply engine. `db` must be the service-role client.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { chat } from "../ai/chat.ts";
import { loadGuardrail, loadProvider } from "../ai/config.ts";
import { decide } from "../ai/quyet.ts";
import { messengerDeps } from "../messenger/db.ts";
import { sendText } from "../messenger/send.ts";
import { type Deps, guardrailState, HISTORY_LIMIT, type Page } from "./engine.ts";

export function botDeps(db: SupabaseClient): Deps {
  const messenger = messengerDeps(db);
  return {
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    loadPage: async (pageId) => {
      // "*" so the reply settings columns are picked up once they exist.
      const { data, error } = await db.from("pages").select("*").eq("id", pageId).maybeSingle();
      if (error) throw new Error("could not load the Page");
      return data as Page | null;
    },
    claim: async (pageId, psid, afterMs) => {
      const { data, error } = await db.rpc("claim_bot_turn", { p_page_id: pageId, p_psid: psid, p_after_ms: afterMs });
      if (error) throw new Error(`could not claim the conversation: ${error.message}`);
      const row = data?.[0];
      return row ? { conversationId: row.conversation_id, upTo: row.reply_up_to } : null;
    },
    finish: async (conversationId, upTo) => {
      const { data, error } = await db.rpc("finish_bot_turn", { p_conversation_id: conversationId, p_up_to: upTo });
      if (error) throw new Error(`could not finish the turn: ${error.message}`);
      return data === true;
    },
    loadTurn: async (conversationId) => {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const [conversation, settings, history, count] = await Promise.all([
        db.from("conversations").select("status, bot_replied_up_to").eq("id", conversationId).single(),
        db.from("bot_settings")
          .select("active_provider, system_prompt, fallback, language, temperature, max_tokens, rate_limit_per_hour, handoff_message, guardrails")
          .single(),
        db.from("messages").select("sender_kind, text, created_at").eq("conversation_id", conversationId)
          .neq("delivery_status", "failed").order("created_at", { ascending: false }).limit(HISTORY_LIMIT),
        db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId)
          .eq("sender_kind", "bot").gte("created_at", hourAgo),
      ]);
      const error = conversation.error ?? settings.error ?? history.error ?? count.error;
      if (error) throw new Error(`could not load the turn: ${error.message}`);
      const rows = (history.data ?? []).reverse();
      const repliedUpTo = Date.parse(conversation.data!.bot_replied_up_to ?? "") || -Infinity;
      return {
        conversation: conversation.data!,
        settings: settings.data!,
        history: rows,
        newCustomerTexts: rows.filter((m) => m.sender_kind === "user" && m.text && Date.parse(m.created_at) > repliedUpTo)
          .map((m) => m.text!),
        botMessagesLastHour: count.count ?? 0,
      };
    },
    loadProvider: (kind) => loadProvider(db, kind),
    chat: (config, messages, params) => chat(config, messages, params),
    guardrail: async (turn) => {
      const { earlier, latest } = guardrailState(turn);
      return decide(chat, await loadGuardrail(db), earlier, latest);
    },
    sendText: (pageId, psid, text, sender) => sendText(messenger, pageId, psid, text, sender),
    handOff: async (conversationId, reason, detail) => {
      const { error } = await db.rpc("hand_off_conversation", {
        p_conversation_id: conversationId, p_reason: reason, p_detail: detail ?? null,
      });
      if (error) console.error("bot: could not hand off", error.message);
    },
  };
}
