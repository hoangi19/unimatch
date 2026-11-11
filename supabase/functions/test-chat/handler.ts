// Admin-only dry run of the reply engine with the Chatbot tab's unsaved draft.
// Never calls the Send API and never writes messages or conversations: the history is the browser's test chat.
// No rate limit: callers are admins (sign-up is off), the input is bounded, chat() has a timeout and the UI
// keeps one request in flight. A per-isolate counter would be unreliable and a DB counter needs a table.
import { AiError, type chat, PROVIDER_KINDS, type ProviderKind } from "../_shared/ai/chat.ts";
import { generate, type HistoryMessage, keywordHandoff, type Settings } from "../_shared/bot/engine.ts";

export type Deps = {
  // Verifies the token with Supabase Auth; null when missing, expired or invalid.
  getUser(token: string): Promise<{ app_metadata?: Record<string, unknown> } | null>;
  // The saved base URL (null when the provider row has none); throws AiError bad_config for an unknown row.
  loadBaseUrl(kind: ProviderKind): Promise<string | null>;
  // The saved Vault key; throws AiError bad_config when none is saved.
  loadKey(kind: ProviderKind): Promise<string>;
  chat: typeof chat;
};

// Mirrors the bot_settings table checks and the Chatbot tab's validation.
const PROMPT_MAX = 6000;
const TEXT_MAX = 2000;
const MESSAGES_MAX = 40;
const LANGUAGES = ["vi", "en", "auto"];
const HEADER_RE = /^[A-Za-z0-9-]+$/;

export type TestChatRequest = {
  settings: Pick<Settings, "system_prompt" | "temperature" | "max_tokens" | "language" | "handoff_message" | "guardrails">;
  provider: { kind: ProviderKind; base_url: string; model: string; extra_headers: Record<string, string> };
  page: { name: string; handoff_keywords: string[] };
  messages: { role: "user" | "bot"; text: string }[];
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = Infinity): v is string => typeof v === "string" && v.length <= max;
const strings = (v: unknown) => Array.isArray(v) && v.every((s) => isStr(s, 200));

// Null when the body is not a valid request.
export function parse(body: unknown): TestChatRequest | null {
  if (!isObj(body) || !isObj(body.settings) || !isObj(body.provider) || !isObj(body.page) || !Array.isArray(body.messages)) return null;
  const { settings: s, provider: p, page, messages } = body;
  const t = s.temperature;
  if (
    !isStr(s.system_prompt, PROMPT_MAX) || !s.system_prompt.trim() || typeof t !== "number" || !(t >= 0 && t <= 1.5) ||
    !Number.isInteger(s.max_tokens) || (s.max_tokens as number) < 64 || !LANGUAGES.includes(s.language as string) ||
    !isStr(s.handoff_message, PROMPT_MAX) || !isObj(s.guardrails)
  ) return null;
  if (
    !PROVIDER_KINDS.includes(p.kind as ProviderKind) || !isStr(p.base_url, 500) || !isStr(p.model, 200) || !isObj(p.extra_headers) ||
    !Object.entries(p.extra_headers).every(([k, v]) => HEADER_RE.test(k) && isStr(v, 1000))
  ) return null;
  if (!isStr(page.name, 200) || !strings(page.handoff_keywords)) return null;
  if (
    !messages.length || messages.length > MESSAGES_MAX || messages.at(-1)?.role !== "user" ||
    !messages.every((m) => isObj(m) && (m.role === "user" || m.role === "bot") && isStr(m.text, TEXT_MAX) && m.text.trim())
  ) return null;
  return body as TestChatRequest;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const user = token ? await deps.getUser(token) : null;
  if (!user) return json({ error: "Sign in required" }, 401);
  if (user.app_metadata?.role !== "admin") return json({ error: "Admin only" }, 403);

  const input = parse(await req.json().catch(() => null));
  if (!input) return json({ error: "Invalid request" }, 400);
  const { provider, page, messages } = input;
  const settings = { ...input.settings, guardrails: { handoff_on_keyword: input.settings.guardrails.handoff_on_keyword === true } };

  // Same order as the live engine: a request for a person never reaches the AI.
  const lastBot = messages.findLastIndex((m) => m.role === "bot");
  const keyword = keywordHandoff(settings.guardrails, messages.slice(lastBot + 1).map((m) => m.text), page.handoff_keywords);
  if (keyword) {
    return json({ ok: true, text: settings.handoff_message, trace: { provider: provider.kind, handoff: { reason: "keyword", keyword } } });
  }

  try {
    const baseUrl = provider.base_url.trim();
    // The saved key may only go to the saved URL.
    if (!baseUrl || baseUrl !== (await deps.loadBaseUrl(provider.kind))) {
      throw new AiError("bad_config", "Save the base URL before testing");
    }
    if (!provider.model.trim()) throw new AiError("bad_config", "Set a model for this provider first");
    const config = {
      kind: provider.kind,
      baseUrl,
      model: provider.model.trim(),
      apiKey: await deps.loadKey(provider.kind),
      extraHeaders: provider.extra_headers,
      supportsTools: false,
    };
    const history: HistoryMessage[] = messages.map((m) => ({ sender_kind: m.role, text: m.text }));
    const full: Settings = { ...settings, active_provider: provider.kind, fallback: "", rate_limit_per_hour: 0 };
    const { text, ...rest } = await generate(
      (c, m, p) => deps.chat(c, m, p, { timeoutMs: 30_000, retries: 0 }),
      config,
      full,
      page.name,
      history,
    );
    return json({ ok: true, text, trace: { provider: provider.kind, ...rest, handoff: null } });
  } catch (e) {
    if (e instanceof AiError) return json({ ok: false, error: { kind: e.kind, message: e.message } });
    console.error("test-chat failed", e instanceof Error ? e.message : "unknown error");
    return json({ ok: false, error: { kind: "provider", message: "Unexpected error" } }, 500);
  }
}
