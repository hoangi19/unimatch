import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.6";
import { AiError, type ChatMessage, type ProviderConfig } from "../ai/chat.ts";
import type { Sender, SendResult } from "../messenger/send.ts";
import { buildPrompt, DEBOUNCE_MS, type Deps, hoursDecision, type Page, runBot, type Settings, type Turn } from "./engine.ts";

const SETTINGS: Settings = {
  active_provider: "openai",
  system_prompt: "You help {{page_name}}.",
  fallback: "Sorry, try again later.",
  language: "auto",
  temperature: 0.4,
  max_tokens: 256,
  rate_limit_per_hour: 30,
};
const PAGE: Page = { id: "p1", name: "UniMatch", bot_enabled: true };
const CONFIG = { kind: "openai", baseUrl: "https://api.example.com/v1", model: "m1", apiKey: "k", extraHeaders: {}, supportsTools: true } as ProviderConfig;

type Sent = { text: string; sender: Sender };

function fake(opts: {
  page?: Partial<Page>;
  turn?: Partial<Turn>;
  chat?: () => Promise<{ text: string }>;
  send?: (n: number) => SendResult;
  claims?: ({ conversationId: string; upTo: string } | null)[];
  more?: boolean[];
} = {}) {
  const sent: Sent[] = [];
  const handoffs: string[] = [];
  const sleeps: number[] = [];
  const claimArgs: (number | null)[] = [];
  const prompts: ChatMessage[][] = [];
  const finished: string[] = [];
  const claims = opts.claims ?? [{ conversationId: "c1", upTo: "2026-01-01T00:00:00.123+00:00" }];
  const more = opts.more ?? [];
  const deps: Deps = {
    now: () => new Date("2026-11-11T03:00:00Z"), // Wednesday 10:00 in Asia/Ho_Chi_Minh
    sleep: (ms) => (sleeps.push(ms), Promise.resolve()),
    loadPage: () => Promise.resolve({ ...PAGE, ...opts.page }),
    claim: (_p, _u, afterMs) => (claimArgs.push(afterMs), Promise.resolve(claims.shift() ?? null)),
    finish: (_c, upTo) => (finished.push(upTo), Promise.resolve(more.shift() ?? false)),
    loadTurn: () =>
      Promise.resolve({
        conversation: { status: "bot" },
        settings: SETTINGS,
        history: [{ sender_kind: "user", text: "hi" }],
        botMessagesLastHour: 0,
        ...opts.turn,
      }),
    loadProvider: () => Promise.resolve(CONFIG),
    chat: async (_config, messages) => {
      prompts.push(messages);
      const { text } = await (opts.chat ?? (() => Promise.resolve({ text: " Hello! " })))();
      return { text, model: "m1-served", usage: { inputTokens: 10, outputTokens: 3 }, latencyMs: 42 };
    },
    sendText: (_p, _u, text, sender) => {
      sent.push({ text, sender });
      return Promise.resolve(opts.send?.(sent.length) ?? { ok: true, messageId: "id", externalId: "mid" });
    },
    handOff: (_c, reason) => (handoffs.push(reason), Promise.resolve()),
  };
  return { deps, sent, handoffs, sleeps, claimArgs, prompts, finished };
}

const failedSend: SendResult = { ok: false, error: { kind: "outside_window", message: "too old" } };

// Silences the engine's log lines for one test.
async function quiet(run: () => Promise<void>) {
  const { log, error } = console;
  console.log = console.error = () => {};
  try {
    await run();
  } finally {
    Object.assign(console, { log, error });
  }
}

Deno.test("happy path: debounces, replies once with a full trace and releases the turn", () =>
  quiet(async () => {
    const f = fake({ page: { reply_delay_ms: 5000 } });
    await runBot(f.deps, "p1", "u1", 1767225600123);
    assertEquals(f.sleeps, [5000]);
    assertEquals(f.claimArgs, [1767225600123]);
    assertEquals(f.sent.length, 1);
    assertEquals(f.sent[0].text, "Hello!");
    const trace = (f.sent[0].sender as { trace: Record<string, unknown> }).trace;
    assertEquals(trace.provider, "openai");
    assertEquals(trace.model, "m1-served");
    assertEquals(trace.latencyMs, 42);
    assertEquals(trace.tokens, { inputTokens: 10, outputTokens: 3 });
    assertEquals((trace.gate as { hours: string }).hours, "always");
    assertEquals(f.finished, ["2026-01-01T00:00:00.123+00:00"]);
    assertEquals(f.handoffs, []);
  }));

Deno.test("the delay never drops below the debounce floor", () =>
  quiet(async () => {
    const f = fake({ claims: [null] });
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.sleeps, [DEBOUNCE_MS]);
    assertEquals(f.sent.length, 0);
  }));

Deno.test("gate: bot off, wrong status, rate limit and closed hours send nothing but still finish", () =>
  quiet(async () => {
    const closed = { reply_mode: "hours" as const, reply_hours: { tz: "Asia/Ho_Chi_Minh", days: { wed: [["13:00", "17:00"]] } } };
    for (
      const f of [
        fake({ page: { bot_enabled: false } }),
        fake({ turn: { conversation: { status: "needs_human" } } }),
        fake({ turn: { botMessagesLastHour: 30 } }),
        fake({ page: closed }),
      ]
    ) {
      await runBot(f.deps, "p1", "u1", 1);
      assertEquals(f.sent.length, 0);
      assertEquals(f.finished.length, 1);
      assertEquals(f.handoffs, []);
    }
  }));

Deno.test("a message during the turn runs one more turn without the newest-message check", () =>
  quiet(async () => {
    const f = fake({
      claims: [{ conversationId: "c1", upTo: "t1" }, { conversationId: "c1", upTo: "t2" }],
      more: [true, false],
    });
    await runBot(f.deps, "p1", "u1", 99);
    assertEquals(f.claimArgs, [99, null]);
    assertEquals(f.sent.length, 2);
    assertEquals(f.finished, ["t1", "t2"]);
  }));

Deno.test("provider error sends the fallback with the error kind in the trace", () =>
  quiet(async () => {
    const f = fake({ chat: () => Promise.reject(new AiError("timeout", "slow")) });
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.sent[0].text, SETTINGS.fallback);
    assertEquals((f.sent[0].sender as { trace: Record<string, unknown> }).trace.fallback, "timeout");
    assertEquals(f.handoffs, []);
  }));

Deno.test("an empty model reply also falls back", () =>
  quiet(async () => {
    const f = fake({ chat: () => Promise.resolve({ text: "  " }) });
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.sent[0].text, SETTINGS.fallback);
  }));

Deno.test("fallback send failure hands the conversation to a human with a reason", () =>
  quiet(async () => {
    const f = fake({ chat: () => Promise.reject(new AiError("auth", "bad key")), send: () => failedSend });
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.handoffs, ["bot: provider auth; fallback send failed: outside_window"]);
    assertEquals(f.finished.length, 1);
  }));

Deno.test("a failed reply send also hands off", () =>
  quiet(async () => {
    const f = fake({ send: () => failedSend });
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.handoffs, ["bot: reply send failed: outside_window"]);
  }));

Deno.test("an unexpected error hands off and still releases the turn", () =>
  quiet(async () => {
    const f = fake();
    f.deps.loadTurn = () => Promise.reject(new Error("db down"));
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.handoffs, ["bot: internal error"]);
    assertEquals(f.finished.length, 1);
  }));

Deno.test("hoursDecision: open, closed, missing day, invalid config", () => {
  const now = new Date("2026-11-11T03:00:00Z"); // Wed 10:00 in Ho Chi Minh, Tue 22:00 in New York
  const page = (reply_hours: unknown): Page => ({ ...PAGE, reply_mode: "hours", reply_hours });
  const days = { wed: [["08:00", "10:00"], ["10:00", "17:30"]], tue: [] };
  assertEquals(hoursDecision(PAGE, now), "always");
  assertEquals(hoursDecision(page({ tz: "Asia/Ho_Chi_Minh", days }), now), "open");
  assertEquals(hoursDecision(page({ tz: "America/New_York", days }), now), "closed");
  assertEquals(hoursDecision(page({ tz: "Asia/Ho_Chi_Minh", days: { mon: [["08:00", "17:00"]] } }), now), "closed");
  assertEquals(hoursDecision(page({}), now), "invalid");
  assertEquals(hoursDecision(page({ tz: "Mars/Olympus", days }), now), "invalid");
  assertEquals(hoursDecision(page({ tz: "Asia/Ho_Chi_Minh", days: { wed: [["8am", "5pm"]] } }), now), "invalid");
});

Deno.test("buildPrompt: page name, language line, roles, merged turns, starts with the customer", () => {
  const messages = buildPrompt({ ...SETTINGS, language: "vi" }, "UniMatch", [
    { sender_kind: "bot", text: "Welcome" },
    { sender_kind: "user", text: "hi" },
    { sender_kind: "user", text: null },
    { sender_kind: "system", text: "note" },
    { sender_kind: "admin", text: "Hello from staff" },
    { sender_kind: "user", text: "jobs?" },
  ]);
  assertStringIncludes(messages[0].content, "You help UniMatch.");
  assertStringIncludes(messages[0].content, "Vietnamese");
  assertEquals(messages.slice(1), [
    { role: "user", content: "hi\n[attachment]" },
    { role: "assistant", content: "Hello from staff" },
    { role: "user", content: "jobs?" },
  ]);
});

Deno.test("buildPrompt keeps the newest history within the character budget", () => {
  const long = "x".repeat(5000);
  const messages = buildPrompt(SETTINGS, "P", [
    { sender_kind: "user", text: "old " + long },
    { sender_kind: "bot", text: long },
    { sender_kind: "user", text: "newest" },
  ]);
  assertEquals(messages.slice(1).map((m) => m.role), ["user"]);
  assertEquals(messages[1].content, "newest");
});
