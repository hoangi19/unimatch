// Messenger webhook: verify handshake (GET), check signature and store events (POST).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN")!;
const APP_SECRET = Deno.env.get("META_APP_SECRET")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function validSignature(body: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expected = "sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare.
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

type MessagingItem = {
  sender?: { id?: string };
  timestamp?: number;
  message?: { mid?: string };
  postback?: { mid?: string };
  [field: string]: unknown;
};

type WebhookPayload = {
  object?: string;
  entry?: { id: string | number; messaging?: MessagingItem[] }[];
};

// One row per messaging item; external_id dedupes Meta's retries.
function toRows(payload: WebhookPayload) {
  const rows = [];
  for (const entry of payload.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const field = m.message ? "messages" : m.postback ? "messaging_postbacks" : Object.keys(m).find((k) => !["sender", "recipient", "timestamp"].includes(k)) ?? "unknown";
      const externalId = m.message?.mid ?? m.postback?.mid ?? `${entry.id}:${m.sender?.id}:${m.timestamp}:${field}`;
      rows.push({ page_id: String(entry.id), field, external_id: externalId, payload: m });
    }
  }
  return rows;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = await req.text();
  if (!(await validSignature(body, req.headers.get("x-hub-signature-256")))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (payload.object !== "page") return new Response("ignored");

  const rows = toRows(payload);
  if (rows.length) {
    const { error } = await db.from("webhook_events").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true });
    // Non-2xx makes Meta retry, so a DB hiccup doesn't lose the event.
    if (error) {
      console.error("store failed", error.message);
      return new Response("store failed", { status: 500 });
    }
  }
  return new Response("EVENT_RECEIVED");
});
