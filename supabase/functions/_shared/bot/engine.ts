// Bot reply engine: debounce, claim the conversation, gate, build the prompt, call the AI provider, send.
// Free of env and network so it can be unit-tested; db.ts wires it to Supabase.
import { AiError, type ChatMessage, type ChatParams, type ChatResult, type ProviderConfig, type ProviderKind } from "../ai/chat.ts";
import type { Decided, StateMessage } from "../ai/quyet.ts";
import { MAX_TEXT, type Sender, type SendResult } from "../messenger/send.ts";

// Floor for the reply delay, so messages sent close together always get one reply.
export const DEBOUNCE_MS = 2_000;
export const HISTORY_LIMIT = 20;
export const HISTORY_CHARS = 8_000;
// Re-runs after a turn when messages keep arriving; bounds one background invocation.
const MAX_TURNS = 3;

// Job search before each reply (pre-retrieval, so it works with every chat provider): embed the customer's
// recent texts, take the nearest jobs and list them under the system prompt.
export type Job = {
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  type: string | null;
  url: string | null;
  similarity: number;
};
export type SearchJobs = (query: string, count: number) => Promise<{ model: string; jobs: Job[] }>;
export const JOB_COUNT = 5;
// Cosine similarity floor; below it a job is not a match. Tuned in live tests.
export const MIN_SIMILARITY = 0.45;
export const SEARCH_TIMEOUT_MS = 5_000;
const QUERY_CHARS = 1_000;
// Earlier customer messages added to the query, so a follow-up ("còn ở HCM thì sao?") keeps its topic.
const QUERY_EARLIER = 2;

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
  guardrails: {
    handoff_on_keyword?: boolean;
    handoff_on_low_confidence?: boolean;
    handoff_on_complaint?: boolean;
    // Model guardrail (Quyet): off unless model_enabled; each check maps one decision to an action.
    model_enabled?: boolean;
    handoff_on_human_request?: boolean;
    refuse_off_topic?: boolean;
    on_model_error?: "reply" | "handoff";
    off_topic_message?: string;
  };
};

// Stored in conversations.handoff_reason and the system event; the Inbox translates it.
export type HandoffReason = "keyword" | "send_failed" | "bot_error" | "low_confidence" | "complaint" | "human_request";

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
  // Model guardrail decision for the turn; throws (AiError on timeout) when the model fails.
  guardrail?: (turn: Turn) => Promise<Decided>;
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

// The keyword guardrail alone; shared with the test-chat dry run.
export function keywordHandoff(guardrails: Settings["guardrails"], texts: string[], keywords: string[]): string | null {
  return guardrails.handoff_on_keyword ? matchKeyword(texts, keywords) : null;
}

// Guardrail state: earlier messages, then the customer texts this turn answers. Staff replies count as the bot's side.
export function guardrailState(turn: Turn): { earlier: StateMessage[]; latest: string[] } {
  const rows = turn.history.filter((m) => m.text && m.sender_kind !== "system");
  let cut = rows.length;
  for (let n = turn.newCustomerTexts.length; cut > 0 && n > 0; cut--) {
    if (rows[cut - 1].sender_kind === "user") n--;
  }
  const earlier = rows.slice(0, cut).map((m): StateMessage => ({ from: m.sender_kind === "user" ? "customer" : "bot", text: m.text! }));
  return { earlier, latest: turn.newCustomerTexts };
}

type Checked = {
  handoff?: { reason: HandoffReason; detail?: Record<string, unknown> };
  // Send the off-topic message instead of calling the reply model.
  refuse?: boolean;
  guardrail?: Record<string, unknown>;
};

// Runs before the hours and rate-limit checks: a request for a person is always flagged.
// Keyword first, then one model guardrail call; a decision whose check is off passes.
async function check(deps: Deps, page: Page, turn: Turn, conversationId: string): Promise<Checked> {
  if (!page.bot_enabled || turn.conversation.status !== "bot") return {};
  const g = turn.settings.guardrails;
  const keyword = keywordHandoff(g, turn.newCustomerTexts, page.handoff_keywords ?? []);
  if (keyword) return { handoff: { reason: "keyword", detail: { keyword } } };
  if (!deps.guardrail || !g.model_enabled || !(g.handoff_on_complaint || g.handoff_on_human_request || g.refuse_off_topic)) {
    return {};
  }

  try {
    const { decision, model, latencyMs } = await deps.guardrail(turn);
    // Never log customer text: decision and latency only.
    console.log(JSON.stringify({ event: "guardrail", conversationId, decision, latencyMs }));
    const guardrail = { model, decision, latencyMs };
    if (decision === "complaint" && g.handoff_on_complaint) return { guardrail, handoff: { reason: "complaint" } };
    if (decision === "human_request" && g.handoff_on_human_request) return { guardrail, handoff: { reason: "human_request" } };
    if (decision === "off_topic_or_abuse" && g.refuse_off_topic) return { guardrail, refuse: true };
    return { guardrail };
  } catch (e) {
    const error = e instanceof AiError ? e.kind : "internal";
    console.error(JSON.stringify({ event: "guardrail", conversationId, error }));
    const guardrail = { decision: "error", error };
    // Fail-open by default: the bot replies as if there were no model guardrail.
    if (g.on_model_error === "handoff") return { guardrail, handoff: { reason: "bot_error", detail: { guardrail_error: error } } };
    return { guardrail };
  }
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

// The search query: this turn's customer texts plus a few earlier ones, newest kept when it runs long.
export function jobQuery(history: HistoryMessage[], newCustomerTexts: string[]): string {
  const texts = history.filter((m) => m.sender_kind === "user" && m.text).map((m) => m.text!);
  const recent = texts.slice(-(newCustomerTexts.length + QUERY_EARLIER));
  return (recent.length ? recent : newCustomerTexts).join("\n").slice(-QUERY_CHARS).trim();
}

// undefined: no search wired (the prompt gets no job section). null: the search failed.
export type Jobs = Job[] | null | undefined;
export type Found = { jobs: Jobs; retrieval?: Record<string, unknown> };

// Never throws: a failed search means "no job list", and the prompt tells the model not to name jobs.
export async function findJobs(search: SearchJobs | undefined, query: string): Promise<Found> {
  if (!search) return { jobs: undefined };
  if (!query) return { jobs: [], retrieval: { count: 0 } };
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiError("timeout", "Job search timed out")), SEARCH_TIMEOUT_MS);
    });
    const { model, jobs } = await Promise.race([search(query, JOB_COUNT), timeout]);
    const matched = jobs.filter((j) => j.similarity >= MIN_SIMILARITY).slice(0, JOB_COUNT);
    return { jobs: matched, retrieval: { model, count: matched.length, latencyMs: Date.now() - started } };
  } catch (e) {
    const error = e instanceof AiError ? e.kind : "internal";
    // Never log the query: it is customer text.
    console.error(JSON.stringify({ event: "job_search", error, latencyMs: Date.now() - started }));
    return { jobs: null, retrieval: { error, latencyMs: Date.now() - started } };
  } finally {
    clearTimeout(timer);
  }
}

// The job section under the system prompt; the seeded prompt refers to it as "Matching jobs".
export function jobSection(jobs: Job[] | null): string {
  if (jobs === null) {
    return "## Matching jobs\nThe job search is unavailable right now. Do not name any specific job, company, salary or link.";
  }
  if (!jobs.length) return "## Matching jobs\nNo job in the system matches this conversation.";
  const lines = jobs.map((j, i) =>
    `${i + 1}. ${[j.title, j.company, j.location, j.salary && `Lương: ${j.salary}`, j.type, j.url].filter(Boolean).join(" | ")}`
  );
  return `## Matching jobs\nFrom the system's job search, best match first. Recommend only these, with links exactly as written.\n${lines.join("\n")}`;
}

export function buildPrompt(settings: Settings, pageName: string, history: HistoryMessage[], jobs?: Jobs): ChatMessage[] {
  const section = jobs === undefined ? "" : `\n\n${jobSection(jobs)}`;
  const system = `${settings.system_prompt.replaceAll("{{page_name}}", pageName)}${section}\n\n${LANGUAGE_LINE[settings.language]}`;
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

export type Generated = { text: string; model: string; latencyMs: number; tokens: ChatResult["usage"] };

// Prompt + provider call + reply cleanup; shared with the test-chat dry run. Throws AiError on an empty reply.
export async function generate(
  chat: Deps["chat"],
  config: ProviderConfig,
  settings: Settings,
  pageName: string,
  history: HistoryMessage[],
  jobs?: Jobs,
): Promise<Generated> {
  const result = await chat(config, buildPrompt(settings, pageName, history, jobs), {
    maxTokens: settings.max_tokens, temperature: Number(settings.temperature),
  });
  const text = result.text.trim().slice(0, MAX_TEXT);
  if (!text) throw new AiError("provider", "Provider returned an empty reply");
  return { text, model: result.model, latencyMs: result.latencyMs, tokens: result.usage };
}

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: "bot_turn", ...fields }));
}

async function reply(deps: Deps, page: Page, psid: string, conversationId: string, upTo: string) {
  const turn = await deps.loadTurn(conversationId);
  const { handoff, refuse, guardrail } = await check(deps, page, turn, conversationId);
  if (handoff) {
    log({ pageId: page.id, conversationId, replyUpTo: upTo, handoff: handoff.reason });
    // Status first, so nothing else answers; a failed notice still leaves it with a person.
    await deps.handOff(conversationId, handoff.reason, handoff.detail);
    const trace = { handoff: handoff.reason, replyUpTo: upTo, ...(guardrail && { guardrail }) };
    const sent = await deps.sendText(page.id, psid, turn.settings.handoff_message, { kind: "bot", trace });
    if (!sent.ok) console.error("bot: handoff message not sent", sent.error.kind);
    return;
  }
  const { ok, decisions } = gate(page, turn, deps.now());
  log({ pageId: page.id, conversationId, replyUpTo: upTo, ok, gate: decisions });
  if (!ok) return;

  const { settings } = turn;
  const trace: Record<string, unknown> = { provider: settings.active_provider, gate: decisions, replyUpTo: upTo };
  if (guardrail) trace.guardrail = guardrail;
  let text: string;
  let failure: string | null = null;
  if (refuse) {
    trace.refused = "off_topic_or_abuse";
    text = settings.guardrails.off_topic_message?.trim() || settings.fallback;
  } else {
    const { jobs, retrieval } = await findJobs(deps.searchJobs, jobQuery(turn.history, turn.newCustomerTexts));
    if (retrieval) trace.retrieval = retrieval;
    try {
      const config = await deps.loadProvider(settings.active_provider);
      trace.model = config.model;
      const { text: reply, ...rest } = await generate(deps.chat, config, settings, page.name, turn.history, jobs);
      Object.assign(trace, rest);
      text = reply;
    } catch (e) {
      failure = e instanceof AiError ? e.kind : "internal";
      console.error("bot: provider failed", failure, e instanceof Error ? e.message : "");
      trace.fallback = failure;
      text = settings.fallback;
    }
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
