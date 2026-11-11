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

export const SEED_MATCH: Filter[] = [
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

export const REGISTRY: SeedEntry[] = [
  {
    table: "webhook_events",
    conflict: "external_id",
    rows: [
      webhookEvent(1, "Xin chào, tôi muốn tìm việc part-time"),
      webhookEvent(2, "Có việc làm cho sinh viên năm nhất không?"),
      webhookEvent(3, "Cảm ơn bạn"),
    ],
    match: SEED_MATCH,
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
