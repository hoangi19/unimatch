// Pure seed data and filter logic. No network, so it is unit-tested directly.
// To seed a new table, add one entry to REGISTRY; its rows must match its own `match` filters.

export const SEED_PAGE_ID = "seed-demo";
export const SEED_PREFIX = "seed:";

export type Filter = { column: string; op: "eq" | "like"; value: string };

export type SeedEntry = {
  table: string;
  // Column used by upsert to skip rows that already exist.
  conflict: string;
  rows: Record<string, unknown>[];
  // Rows matching all filters are the only ones --clean deletes.
  match: Filter[];
};

export const WEBHOOK_EVENTS_MATCH: Filter[] = [
  { column: "page_id", op: "eq", value: SEED_PAGE_ID },
  { column: "external_id", op: "like", value: `${SEED_PREFIX}%` },
];

function webhookEvent(n: number, text: string): Record<string, unknown> {
  const sender = `seed-user-${n}`;
  return {
    page_id: SEED_PAGE_ID,
    field: "messages",
    external_id: `${SEED_PREFIX}m${n}`,
    payload: {
      sender: { id: sender },
      recipient: { id: SEED_PAGE_ID },
      timestamp: 1767225600000 + n * 1000,
      message: { mid: `${SEED_PREFIX}m${n}`, text },
    },
  };
}

export const PAGES_MATCH: Filter[] = [
  { column: "id", op: "eq", value: SEED_PAGE_ID },
  { column: "name", op: "like", value: `${SEED_PREFIX}%` },
];

export const CONVERSATIONS_MATCH: Filter[] = [
  { column: "page_id", op: "eq", value: SEED_PAGE_ID },
  { column: "psid", op: "like", value: `${SEED_PREFIX}%` },
];

export const MESSAGES_MATCH: Filter[] = [{ column: "external_id", op: "like", value: `${SEED_PREFIX}%` }];

// Fixed ids so seed messages can point at seed conversations.
const SEED_CONV_BOT = "5eed0000-0000-4000-8000-000000000001";
const SEED_CONV_NEEDS = "5eed0000-0000-4000-8000-000000000002";

function conversation(id: string, n: number, name: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    page_id: SEED_PAGE_ID,
    psid: `${SEED_PREFIX}user-${n}`,
    customer_name: name,
    language: "vi",
    last_message_at: "2026-01-01T00:01:00Z",
    last_customer_message_at: "2026-01-01T00:01:00Z",
    ...extra,
  };
}

function message(n: number, conversationId: string, senderKind: string, text: string): Record<string, unknown> {
  return {
    conversation_id: conversationId,
    sender_kind: senderKind,
    text,
    external_id: `${SEED_PREFIX}msg${n}`,
    created_at: `2026-01-01T00:00:0${n}Z`,
  };
}

export const REGISTRY: SeedEntry[] = [
  {
    table: "webhook_events",
    conflict: "external_id",
    rows: [
      webhookEvent(1, "Xin chào, tôi muốn tìm việc part-time"),
      webhookEvent(2, "Có việc làm cho sinh viên năm nhất không?"),
      webhookEvent(3, "Cảm ơn bạn"),
    ],
    match: WEBHOOK_EVENTS_MATCH,
  },
  {
    table: "pages",
    conflict: "id",
    rows: [{ id: SEED_PAGE_ID, name: `${SEED_PREFIX} Demo page` }],
    match: PAGES_MATCH,
  },
  {
    table: "conversations",
    conflict: "id",
    rows: [
      conversation(SEED_CONV_BOT, 1, "Nguyễn Minh Anh", { status: "bot", unread_count: 1, last_message_preview: "Cảm ơn bạn" }),
      conversation(SEED_CONV_NEEDS, 2, "Trần Quốc Bảo", {
        status: "needs_human",
        handoff_reason: "user typed handoff keyword",
        handoff_at: "2026-01-01T00:01:00Z",
        unread_count: 2,
        last_message_preview: "gặp nhân viên",
        notes: "Asked about Data Engineer roles in Hanoi.",
      }),
    ],
    match: CONVERSATIONS_MATCH,
  },
  {
    table: "messages",
    conflict: "external_id",
    rows: [
      message(1, SEED_CONV_BOT, "user", "Xin chào, tôi muốn tìm việc part-time"),
      message(2, SEED_CONV_BOT, "bot", "Chào bạn! Bạn muốn tìm việc ở khu vực nào?"),
      message(3, SEED_CONV_BOT, "user", "Cảm ơn bạn"),
      message(4, SEED_CONV_NEEDS, "user", "gặp nhân viên"),
      message(5, SEED_CONV_NEEDS, "system", "Handed off: user typed handoff keyword"),
    ],
    match: MESSAGES_MATCH,
  },
];

export function cleanOrder(registry: SeedEntry[]): SeedEntry[] {
  return [...registry].reverse();
}

function likeToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("%")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

export function rowMatches(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((f) => {
    const cell = String(row[f.column]);
    return f.op === "eq" ? cell === f.value : likeToRegExp(f.value).test(cell);
  });
}

// --clean refuses any entry whose filters do not pin rows to the seed prefix.
export function hasSeedPrefixFilter(filters: Filter[]): boolean {
  return filters.some((f) => f.op === "like" && f.value.startsWith(SEED_PREFIX));
}
