// Messenger webhook logic, free of env and network so it can be unit-tested. Wired up in index.ts.

type Row = { page_id: string; field: string; external_id: string; payload: MessagingItem };

export type Deps = {
  verifyToken: string;
  appSecret: string;
  // Inserts rows, skipping known external_ids. Returns an error message on failure.
  store: (rows: Row[]) => Promise<string | null>;
};

export async function validSignature(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
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

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === deps.verifyToken;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = await req.text();
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
  }
  return new Response("EVENT_RECEIVED");
}
