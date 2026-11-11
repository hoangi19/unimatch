// Messenger webhook logic, free of env and network so it can be unit-tested. Wired up in index.ts.

type Row = { page_id: string; field: string; external_id: string; payload: MessagingItem };

export type Deps = {
  verifyToken: string;
  appSecret: string;
  // Inserts rows, skipping known external_ids. Returns an error message on failure.
  store: (rows: Row[]) => Promise<string | null>;
  // Called after a successful store with each conversation that got customer messages; must not block.
  onUserMessages?: (targets: Target[]) => void;
};

export type Target = { pageId: string; psid: string; at: number };

export async function validSignature(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return safeEqual("sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join(""), header);
}

// Constant-time compare (length still leaks, which is public anyway).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Meta batches are a few KB; anything far bigger is not from Meta.
export const MAX_BODY_BYTES = 1024 * 1024;

type MessagingItem = {
  sender?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; is_echo?: boolean };
  postback?: { mid?: string };
  [field: string]: unknown;
};

type WebhookPayload = {
  object?: string;
  entry?: { id: string | number; messaging?: MessagingItem[] }[];
};

// One row per messaging item; external_id dedupes Meta's retries.
export function toRows(payload: WebhookPayload): Row[] {
  const rows: Row[] = [];
  for (const entry of payload.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const field = m.message ? "messages" : m.postback ? "messaging_postbacks" : Object.keys(m).find((k) => !["sender", "recipient", "timestamp"].includes(k)) ?? "unknown";
      const externalId = m.message?.mid ?? m.postback?.mid ?? `${entry.id}:${m.sender?.id}:${m.timestamp}:${field}`;
      rows.push({ page_id: String(entry.id), field, external_id: externalId, payload: m });
    }
  }
  return rows;
}

// Customer messages and postbacks, one target per conversation with its newest Meta timestamp.
export function userTargets(rows: Row[]): Target[] {
  const latest = new Map<string, Target>();
  for (const { page_id, field, payload } of rows) {
    const psid = payload.sender?.id;
    const fromCustomer = (field === "messages" && !payload.message?.is_echo) || field === "messaging_postbacks";
    if (!fromCustomer || !psid || typeof payload.timestamp !== "number") continue;
    const key = `${page_id}:${psid}`;
    if ((latest.get(key)?.at ?? -1) < payload.timestamp) latest.set(key, { pageId: page_id, psid, at: payload.timestamp });
  }
  return [...latest.values()];
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" &&
      safeEqual(url.searchParams.get("hub.verify_token") ?? "", deps.verifyToken);
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new Response("Payload Too Large", { status: 413 });
  const body = await req.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return new Response("Payload Too Large", { status: 413 });
  // An empty key makes importKey throw; say why instead of crashing on every signed delivery.
  if (!deps.appSecret) {
    console.error("meta-webhook: META_APP_SECRET is not set");
    return new Response("Webhook not configured", { status: 500 });
  }
  if (!(await validSignature(body, req.headers.get("x-hub-signature-256"), deps.appSecret))) {
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
    const error = await deps.store(rows);
    // Non-2xx makes Meta retry, so a DB hiccup doesn't lose the event.
    if (error) {
      console.error("store failed", error);
      return new Response("store failed", { status: 500 });
    }
    // Retries run this again; claim_bot_turn makes that a no-op once the message is answered.
    deps.onUserMessages?.(userTargets(rows));
  }
  return new Response("EVENT_RECEIVED");
}
