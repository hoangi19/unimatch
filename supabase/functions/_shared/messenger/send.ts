// Sends a text message to a Messenger customer through the Send API and stores it as a messages row.
// Only standard replies inside the 24-hour window: message tags need Meta approval we do not have.
import { GRAPH_VERSION } from "../graph.ts";

export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_TEXT = 2000;

export type SendErrorKind = "not_found" | "outside_window" | "token_invalid" | "rate_limit" | "user_unavailable" | "send_failed";
export type SendError = { kind: SendErrorKind; message: string };
export type SendResult =
  // messageId is null only when Meta accepted the message but storing it failed; the echo stores it later.
  | { ok: true; messageId: string | null; externalId: string }
  | { ok: false; error: SendError; messageId?: string };

export type Sender = { kind: "bot"; trace?: Record<string, unknown> } | { kind: "admin"; adminId: string };

export type OutboundRow = {
  conversationId: string;
  sender: Sender;
  text: string;
  externalId: string | null;
  deliveryError: string | null;
};

export type Deps = {
  fetch: typeof fetch;
  now(): Date;
  findConversation(pageId: string, psid: string): Promise<{ id: string; lastCustomerMessageAt: string | null } | null>;
  // Service role only; the token is never logged, stored elsewhere or returned.
  getPageToken(pageId: string): Promise<string | null>;
  record(row: OutboundRow): Promise<string>;
  markTokenInvalid(pageId: string): Promise<void>;
};

const MESSAGES: Record<SendErrorKind, string> = {
  not_found: "Conversation not found",
  outside_window: "The customer's last message is older than 24 hours",
  token_invalid: "The Page access token is invalid or expired; reconnect the Page",
  rate_limit: "Messenger rate limit reached; try again later",
  user_unavailable: "This person is not available on Messenger right now",
  send_failed: "Messenger did not accept the message",
};

function fail(kind: SendErrorKind, detail = ""): SendError {
  return { kind, message: MESSAGES[kind] + detail };
}

// Maps a Graph API error object to a kind. Only codes go into the message, never Graph's own text.
export function classifyGraphError(err: { code?: number; error_subcode?: number } | undefined): SendError {
  const code = err?.code;
  const sub = err?.error_subcode;
  const detail = code === undefined ? "" : ` (Graph error ${code}${sub ? `/${sub}` : ""})`;
  if (code === 190 || code === 102) return fail("token_invalid", detail);
  if (code === 4 || code === 17 || code === 32 || code === 613) return fail("rate_limit", detail);
  if (code === 551 || (code === 100 && sub === 2018001)) return fail("user_unavailable", detail);
  if (code === 10 && sub === 2018278) return fail("outside_window", detail);
  return fail("send_failed", detail);
}

async function postMessage(deps: Deps, token: string, psid: string, text: string): Promise<{ mid: string } | SendError> {
  let res: Response;
  try {
    res = await deps.fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages`, {
      method: "POST",
      // Header, not ?access_token=, so the token never appears in a URL.
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { text } }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return fail("send_failed", " (network error or timeout)");
  }
  const body = await res.json().catch(() => null);
  if (res.ok && typeof body?.message_id === "string") return { mid: body.message_id };
  return body?.error ? classifyGraphError(body.error) : fail("send_failed", ` (HTTP ${res.status})`);
}

export async function sendText(deps: Deps, pageId: string, psid: string, text: string, sender: Sender): Promise<SendResult> {
  const conv = await deps.findConversation(pageId, psid);
  if (!conv) return { ok: false, error: fail("not_found") };
  const last = conv.lastCustomerMessageAt ? Date.parse(conv.lastCustomerMessageAt) : NaN;
  if (!(deps.now().getTime() - last < WINDOW_MS)) return { ok: false, error: fail("outside_window") };

  const token = await deps.getPageToken(pageId);
  const sent = token ? await postMessage(deps, token, psid, text) : fail("token_invalid", " (no token saved)");

  if ("mid" in sent) {
    try {
      const messageId = await deps.record({ conversationId: conv.id, sender, text, externalId: sent.mid, deliveryError: null });
      return { ok: true, messageId, externalId: sent.mid };
    } catch (e) {
      // Do not report a failure: the customer got the message, and a retry would send it twice.
      console.error("messenger: sent but not stored", e instanceof Error ? e.message : "unknown error");
      return { ok: true, messageId: null, externalId: sent.mid };
    }
  }

  if (sent.kind === "token_invalid") await deps.markTokenInvalid(pageId);
  const messageId = await deps.record({ conversationId: conv.id, sender, text, externalId: null, deliveryError: sent.message });
  return { ok: false, error: sent, messageId };
}
