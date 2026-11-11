// Bot reply engine: debounce, claim the conversation, gate, build the prompt, call the AI provider, send.
// Free of env and network so it can be unit-tested; db.ts wires it to Supabase.
import { AiError, type ChatMessage, type ChatParams, type ChatResult, type ProviderConfig, type ProviderKind } from "../ai/chat.ts";
import { MAX_TEXT, type Sender, type SendResult } from "../messenger/send.ts";

// Floor for the reply delay, so messages sent close together always get one reply.
export const DEBOUNCE_MS = 2_000;
export const HISTORY_LIMIT = 20;
export const HISTORY_CHARS = 8_000;
// Re-runs after a turn when messages keep arriving; bounds one background invocation.
const MAX_TURNS = 3;

// Retrieval hook for a later search_jobs tool (Dataset tab). Not called yet.
export type JobQuery = { query: string; location?: string; remote?: boolean; seniority?: string; topK?: number };
export type Job = { title: string; company: string; location: string; url: string };
export type SearchJobs = (query: JobQuery) => Promise<Job[]>;

// The per-page reply settings are optional so the engine also runs before those columns exist.
export type Page = {
  id: string;
  name: string;
  bot_enabled: boolean;
  reply_mode?: "always" | "hours";
  reply_hours?: unknown;
  reply_delay_ms?: number;
  handoff_keywords?: string[];
};

export type Settings = {
  active_provider: ProviderKind;
  system_prompt: string;
  fallback: string;
  language: "vi" | "en" | "auto";
  temperature: number;
  max_tokens: number;
  rate_limit_per_hour: number;
  handoff_message: string;
  guardrails: { handoff_on_keyword?: boolean; handoff_on_low_confidence?: boolean; handoff_on_complaint?: boolean };
};

// Stored in conversations.handoff_reason and the system event; the Inbox translates it.
export type HandoffReason = "keyword" | "send_failed" | "bot_error" | "low_confidence" | "complaint";

export type HistoryMessage = { sender_kind: "user" | "bot" | "admin" | "system"; text: string | null };

export type Turn = {
  conversation: { status: string };
  settings: Settings;
  // Newest last.
  history: HistoryMessage[];
  // Customer texts not answered yet (after the bot's watermark, up to this turn), oldest first.
  newCustomerTexts: string[];
  botMessagesLastHour: number;
};

export type Deps = {
  now(): Date;
  sleep(ms: number): Promise<void>;
  loadPage(pageId: string): Promise<Page | null>;
  claim(pageId: string, psid: string, afterMs: number | null): Promise<{ conversationId: string; upTo: string } | null>;
  // Returns true when a customer message arrived during the turn.
  finish(conversationId: string, upTo: string): Promise<boolean>;
  loadTurn(conversationId: string): Promise<Turn>;
  loadProvider(kind: ProviderKind): Promise<ProviderConfig>;
  chat(config: ProviderConfig, messages: ChatMessage[], params: ChatParams): Promise<ChatResult>;
  sendText(pageId: string, psid: string, text: string, sender: Sender): Promise<SendResult>;
  handOff(conversationId: string, reason: HandoffReason, detail?: Record<string, unknown>): Promise<void>;
  searchJobs?: SearchJobs;
  // shortcut: no low-confidence or complaint classifier exists yet; wire one here when it does.
  detectHandoff?: (turn: Turn) => Promise<"low_confidence" | "complaint" | null>;
};

export type HoursDecision = "always" | "open" | "closed" | "invalid";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// reply_hours: {"tz": "Asia/Ho_Chi_Minh", "days": {"mon": [["08:00","17:30"]], ..., "sun": []}}.
// A day missing from `days` is closed; a malformed config is "invalid" and the bot replies anyway.
export function hoursDecision(page: Page, now: Date): HoursDecision {
  if ((page.reply_mode ?? "always") !== "hours") return "always";
  const hours = page.reply_hours as { tz?: unknown; days?: Record<string, unknown> } | null;
  if (typeof hours?.tz !== "string" || typeof hours.days !== "object" || hours.days === null) return "invalid";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: hours.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return "invalid";
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = part("weekday").toLowerCase().slice(0, 3);
  const time = `${part("hour")}:${part("minute")}`;
  if (!DAYS.includes(day)) return "invalid";
  const ranges = hours.days[day] ?? [];
  if (!Array.isArray(ranges)) return "invalid";
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every((t) => typeof t === "string" && HHMM.test(t))) {
      return "invalid";
    }
    if (range[0] <= time && time < range[1]) return "open";
  }
  return "closed";
}

// Case-, accent- and punctuation-insensitive, so "Gặp NGƯỜI thật!" matches "gap nguoi that".
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Whole words only, so "admin" does not match inside "administrator".
export function matchKeyword(texts: string[], keywords: string[]): string | null {
  const haystack = ` ${texts.map(normalize).join(" ")} `;
  return keywords.find((k) => normalize(k) && haystack.includes(` ${normalize(k)} `)) ?? null;
}

// Runs before the hours and rate-limit checks: a request for a person is always flagged.
async function detectHandoff(deps: Deps, page: Page, turn: Turn): Promise<{ reason: HandoffReason; detail?: Record<string, unknown> } | null> {
  if (!page.bot_enabled || turn.conversation.status !== "bot") return null;
  const { guardrails } = turn.settings;
  if (guardrails.handoff_on_keyword) {
    const keyword = matchKeyword(turn.newCustomerTexts, page.handoff_keywords ?? []);
    if (keyword) return { reason: "keyword", detail: { keyword } };
  }
  if (deps.detectHandoff && (guardrails.handoff_on_low_confidence || guardrails.handoff_on_complaint)) {
    const reason = await deps.detectHandoff(turn);
    if (reason && guardrails[`handoff_on_${reason}`]) return { reason };
  }
  return null;
}

export type Gate = {
  botEnabled: boolean;
  status: string;
  hours: HoursDecision;
  botMessagesLastHour: number;
  rateLimitPerHour: number;
};

export function gate(page: Page, turn: Turn, now: Date): { ok: boolean; decisions: Gate } {
  const decisions: Gate = {
    botEnabled: page.bot_enabled,
    status: turn.conversation.status,
    hours: hoursDecision(page, now),
    botMessagesLastHour: turn.botMessagesLastHour,
    rateLimitPerHour: turn.settings.rate_limit_per_hour,
  };
  const ok = decisions.botEnabled && decisions.status === "bot" && decisions.hours !== "closed" &&
    decisions.botMessagesLastHour < decisions.rateLimitPerHour;
  return { ok, decisions };
}

const LANGUAGE_LINE = {
  vi: "Always reply in Vietnamese.",
  en: "Always reply in English.",
  auto: "Reply in the language of the customer's latest message.",
};

export function buildPrompt(settings: Settings, pageName: string, history: HistoryMessage[]): ChatMessage[] {
  const system = `${settings.system_prompt.replaceAll("{{page_name}}", pageName)}\n\n${LANGUAGE_LINE[settings.language]}`;
  // Newest messages first until the budget runs out; same-role neighbours merge because some APIs need alternation.
  const turns: ChatMessage[] = [];
  let chars = 0;
  for (const m of [...history].reverse()) {
    if (m.sender_kind === "system") continue;
    const content = m.text ?? "[attachment]";
    if (chars + content.length > HISTORY_CHARS && turns.length) break;
    chars += content.length;
    const role = m.sender_kind === "user" ? "user" : "assistant";
    if (turns[0]?.role === role) turns[0].content = `${content}\n${turns[0].content}`;
    else turns.unshift({ role, content });
  }
  // Conversations must start with the customer.
  while (turns[0]?.role === "assistant") turns.shift();
  return [{ role: "system", content: system }, ...turns];
}

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: "bot_turn", ...fields }));
}

async function reply(deps: Deps, page: Page, psid: string, conversationId: string, upTo: string) {
  const turn = await deps.loadTurn(conversationId);
  const handoff = await detectHandoff(deps, page, turn);
  if (handoff) {
    log({ pageId: page.id, conversationId, replyUpTo: upTo, handoff: handoff.reason });
    // Status first, so nothing else answers; a failed notice still leaves it with a person.
    await deps.handOff(conversationId, handoff.reason, handoff.detail);
    const sent = await deps.sendText(page.id, psid, turn.settings.handoff_message, { kind: "bot", trace: { handoff: handoff.reason, replyUpTo: upTo } });
    if (!sent.ok) console.error("bot: handoff message not sent", sent.error.kind);
    return;
  }
  const { ok, decisions } = gate(page, turn, deps.now());
  log({ pageId: page.id, conversationId, replyUpTo: upTo, ok, gate: decisions });
  if (!ok) return;

  const { settings } = turn;
  const trace: Record<string, unknown> = { provider: settings.active_provider, gate: decisions, replyUpTo: upTo };
  let text: string;
  let failure: string | null = null;
  try {
    const config = await deps.loadProvider(settings.active_provider);
    trace.model = config.model;
    const result = await deps.chat(config, buildPrompt(settings, page.name, turn.history), {
      maxTokens: settings.max_tokens, temperature: Number(settings.temperature),
    });
    Object.assign(trace, { model: result.model, latencyMs: result.latencyMs, tokens: result.usage });
    text = result.text.trim().slice(0, MAX_TEXT);
    if (!text) throw new AiError("provider", "Provider returned an empty reply");
  } catch (e) {
    failure = e instanceof AiError ? e.kind : "internal";
    console.error("bot: provider failed", failure, e instanceof Error ? e.message : "");
    trace.fallback = failure;
    text = settings.fallback;
  }

  const sent = await deps.sendText(page.id, psid, text, { kind: "bot", trace });
  if (!sent.ok) {
    await deps.handOff(conversationId, "send_failed", { send_error: sent.error.kind, ...(failure && { provider_error: failure }) });
  }
}

// Runs in the background after meta-webhook stored a customer message sent at afterMs (Meta timestamp).
export async function runBot(deps: Deps, pageId: string, psid: string, afterMs: number): Promise<void> {
  try {
    for (let n = 0; n < MAX_TURNS; n++) {
      const page = await deps.loadPage(pageId);
      if (!page) return;
      await deps.sleep(Math.max(page.reply_delay_ms ?? 0, DEBOUNCE_MS));
      // Only the first round checks for newer messages: a re-run answers whatever has arrived.
      const claimed = await deps.claim(pageId, psid, n === 0 ? afterMs : null);
      if (!claimed) return;
      try {
        await reply(deps, page, psid, claimed.conversationId, claimed.upTo);
      } catch (e) {
        console.error("bot: turn failed", e instanceof Error ? e.message : "unknown error");
        await deps.handOff(claimed.conversationId, "bot_error").catch(() => {});
      }
      if (!(await deps.finish(claimed.conversationId, claimed.upTo))) return;
    }
  } catch (e) {
    console.error("bot: run failed", e instanceof Error ? e.message : "unknown error");
  }
}
