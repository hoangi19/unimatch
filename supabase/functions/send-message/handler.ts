// Admin manual send: POST {conversation_id, text} with the admin's Supabase session token.
import { MAX_TEXT, type Sender, type SendResult } from "../_shared/messenger/send.ts";

export type Deps = {
  // Verifies the token with Supabase Auth; null when missing, expired or invalid.
  getUser(token: string): Promise<{ id: string; app_metadata?: Record<string, unknown> } | null>;
  findConversation(id: string): Promise<{ pageId: string; psid: string } | null>;
  sendText(pageId: string, psid: string, text: string, sender: Sender): Promise<SendResult>;
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const user = token ? await deps.getUser(token) : null;
  if (!user) return json({ error: "Sign in required" }, 401);
  if (user.app_metadata?.role !== "admin") return json({ error: "Admin only" }, 403);

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (typeof body?.conversation_id !== "string" || !UUID.test(body.conversation_id)) {
    return json({ error: "conversation_id must be a uuid" }, 400);
  }
  if (!text || text.length > MAX_TEXT) return json({ error: `text must be 1 to ${MAX_TEXT} characters` }, 400);

  try {
    const conv = await deps.findConversation(body.conversation_id);
    if (!conv) return json({ ok: false, error: { kind: "not_found", message: "Conversation not found" } }, 404);
    const result = await deps.sendText(conv.pageId, conv.psid, text, { kind: "admin", adminId: user.id });
    return result.ok
      ? json({ ok: true, message_id: result.messageId })
      : json({ ok: false, message_id: result.messageId ?? null, error: result.error });
  } catch (e) {
    console.error("send-message failed", e instanceof Error ? e.message : "unknown error");
    return json({ ok: false, error: { kind: "send_failed", message: "Unexpected error" } }, 500);
  }
}
