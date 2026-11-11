import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.6";
import { AiError, type ChatMessage, type ProviderConfig } from "../ai/chat.ts";
import type { Sender, SendResult } from "../messenger/send.ts";
import type { Decided } from "../ai/quyet.ts";
import {
  buildPrompt,
  DEBOUNCE_MS,
  type Deps,
  findJobs,
  guardrailState,
  hoursDecision,
  type Job,
  jobQuery,
  matchKeyword,
  MIN_SIMILARITY,
  type Page,
  runBot,
  type Settings,
  type Turn,
} from "./engine.ts";

const SETTINGS: Settings = {
  active_provider: "openai",
  system_prompt: "You help {{page_name}}.",
  fallback: "Sorry, try again later.",
  language: "auto",
  temperature: 0.4,
  max_tokens: 256,
  rate_limit_per_hour: 30,
  handoff_message: "A teammate will reply soon.",
  guardrails: { handoff_on_keyword: true },
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
  const handoffs: unknown[] = [];
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
        newCustomerTexts: ["hi"],
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
    handOff: (_c, reason, detail) => (handoffs.push(detail ? [reason, detail] : reason), Promise.resolve()),
  };
  return { deps, sent, handoffs, sleeps, claimArgs, prompts, finished };
}

const failedSend: SendResult = { ok: false, error: { kind: "outside_window", message: "too old" } };

// Silences the engine's log lines for one test.
async function quiet<T>(run: () => Promise<T>): Promise<T> {
  const { log, error } = console;
  console.log = console.error = () => {};
  try {
    return await run();
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
    assertEquals(f.handoffs, [["send_failed", { send_error: "outside_window", provider_error: "auth" }]]);
    assertEquals(f.finished.length, 1);
  }));

Deno.test("a failed reply send also hands off", () =>
  quiet(async () => {
    const f = fake({ send: () => failedSend });
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.handoffs, [["send_failed", { send_error: "outside_window" }]]);
  }));

Deno.test("an unexpected error hands off and still releases the turn", () =>
  quiet(async () => {
    const f = fake();
    f.deps.loadTurn = () => Promise.reject(new Error("db down"));
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.handoffs, ["bot_error"]);
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

Deno.test("matchKeyword: case, accents, đ and punctuation do not matter; whole words only", () => {
  const keywords = ["gặp người thật", "nhân viên", "admin"];
  assertEquals(matchKeyword(["Cho mình GAP NGUOI THAT!!"], keywords), "gặp người thật");
  assertEquals(matchKeyword(["toi muon gap", "nguoi that"], keywords), "gặp người thật");
  assertEquals(matchKeyword(["Nhân-viên ơi"], keywords), "nhân viên");
  assertEquals(matchKeyword(["Đi đâu"], ["di dau"]), "di dau");
  assertEquals(matchKeyword(["the administrator role"], keywords), null);
  assertEquals(matchKeyword(["hello"], ["", "  "]), null);
  assertEquals(matchKeyword([], keywords), null);
});

const KEYWORD_TURN = { newCustomerTexts: ["older", "Cho em gặp NHÂN VIÊN với"] };

Deno.test("keyword handoff: hands off, sends the handoff message, never calls the AI", () =>
  quiet(async () => {
    const f = fake({ page: { handoff_keywords: ["nhan vien"] }, turn: KEYWORD_TURN });
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.handoffs, [["keyword", { keyword: "nhan vien" }]]);
    assertEquals(f.prompts.length, 0);
    assertEquals(f.sent.map((s) => s.text), ["A teammate will reply soon."]);
    assertEquals((f.sent[0].sender as { trace: Record<string, unknown> }).trace.handoff, "keyword");
    assertEquals(f.finished.length, 1);
  }));

Deno.test("keyword handoff ignores hours and rate limit, and stays handed off when the notice fails", () =>
  quiet(async () => {
    const closed = { reply_mode: "hours" as const, reply_hours: { tz: "Asia/Ho_Chi_Minh", days: {} } };
    const f = fake({
      page: { handoff_keywords: ["nhan vien"], ...closed },
      turn: { ...KEYWORD_TURN, botMessagesLastHour: 99 },
      send: () => failedSend,
    });
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.handoffs, [["keyword", { keyword: "nhan vien" }]]);
    assertEquals(f.sent.length, 1);
  }));

Deno.test("no keyword handoff when the guardrail is off, the bot is off, a person owns it, or nothing matches", () =>
  quiet(async () => {
    const page = { handoff_keywords: ["nhan vien"] };
    for (
      const f of [
        fake({ page, turn: { ...KEYWORD_TURN, settings: { ...SETTINGS, guardrails: { handoff_on_keyword: false } } } }),
        fake({ page: { ...page, bot_enabled: false }, turn: KEYWORD_TURN }),
        fake({ page, turn: { ...KEYWORD_TURN, conversation: { status: "human" } } }),
        fake({ page, turn: { newCustomerTexts: ["xin chao"] } }),
      ]
    ) {
      await runBot(f.deps, "p1", "u1", 1);
      assertEquals(f.handoffs, []);
      assertEquals(f.sent.every((s) => s.text !== "A teammate will reply soon."), true);
    }
  }));

const MODEL_ON: Settings["guardrails"] = {
  handoff_on_keyword: true,
  model_enabled: true,
  handoff_on_complaint: true,
  handoff_on_human_request: true,
  refuse_off_topic: true,
  off_topic_message: "Jobs only, sorry.",
};
const withGuardrails = (guardrails: Settings["guardrails"]) => ({ settings: { ...SETTINGS, guardrails } });
const traceOf = (s: Sent) => (s.sender as { trace: Record<string, unknown> }).trace;
const decided = (decision: Decided["decision"]) => () => Promise.resolve({ decision, model: "Quyet-1.0-Large", latencyMs: 300 });

Deno.test("guardrail complaint and human request hand off with the decision in the trace", () =>
  quiet(async () => {
    for (const decision of ["complaint", "human_request"] as const) {
      const f = fake({ turn: withGuardrails(MODEL_ON) });
      f.deps.guardrail = decided(decision);
      await runBot(f.deps, "p1", "u1", 1);
      assertEquals(f.handoffs, [decision]);
      assertEquals(f.prompts.length, 0);
      assertEquals(f.sent.map((s) => s.text), ["A teammate will reply soon."]);
      assertEquals(traceOf(f.sent[0]).guardrail, { model: "Quyet-1.0-Large", decision, latencyMs: 300 });
    }
  }));

Deno.test("guardrail off-topic sends the off-topic message without calling the reply model", () =>
  quiet(async () => {
    const f = fake({ turn: withGuardrails(MODEL_ON) });
    f.deps.guardrail = decided("off_topic_or_abuse");
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(f.handoffs, []);
    assertEquals(f.prompts.length, 0);
    assertEquals(f.sent.map((s) => s.text), ["Jobs only, sorry."]);
    assertEquals(traceOf(f.sent[0]).refused, "off_topic_or_abuse");
    assertEquals((traceOf(f.sent[0]).guardrail as { decision: string }).decision, "off_topic_or_abuse");
  }));

Deno.test("guardrail: normal or a decision whose check is off replies as usual, with the decision traced", () =>
  quiet(async () => {
    const cases = [
      ["normal", MODEL_ON],
      ["complaint", { ...MODEL_ON, handoff_on_complaint: false }],
      ["human_request", { ...MODEL_ON, handoff_on_human_request: false }],
      ["off_topic_or_abuse", { ...MODEL_ON, refuse_off_topic: false }],
    ] as const;
    for (const [decision, guardrails] of cases) {
      const f = fake({ turn: withGuardrails(guardrails) });
      f.deps.guardrail = decided(decision);
      await runBot(f.deps, "p1", "u1", 1);
      assertEquals(f.handoffs, []);
      assertEquals(f.sent.map((s) => s.text), ["Hello!"]);
      assertEquals((traceOf(f.sent[0]).guardrail as { decision: string }).decision, decision);
    }
  }));

Deno.test("guardrail is not called when the model is off, every check is off, or a keyword matched", () =>
  quiet(async () => {
    const cases = [
      fake({ turn: withGuardrails({ ...MODEL_ON, model_enabled: false }) }),
      fake({ turn: withGuardrails({ ...MODEL_ON, handoff_on_complaint: false, handoff_on_human_request: false, refuse_off_topic: false }) }),
      fake({ page: { handoff_keywords: ["nhan vien"] }, turn: { ...KEYWORD_TURN, ...withGuardrails(MODEL_ON) } }),
    ];
    for (const f of cases) {
      let calls = 0;
      f.deps.guardrail = () => (calls++, decided("complaint")());
      await runBot(f.deps, "p1", "u1", 1);
      assertEquals(calls, 0);
      assertEquals(f.sent.every((s) => traceOf(s).guardrail === undefined), true);
    }
  }));

Deno.test("guardrail failure fails open by default and hands off when set to", () =>
  quiet(async () => {
    const open = fake({ turn: withGuardrails(MODEL_ON) });
    open.deps.guardrail = () => Promise.reject(new AiError("timeout", "slow"));
    await runBot(open.deps, "p1", "u1", 1);
    assertEquals(open.handoffs, []);
    assertEquals(open.sent.map((s) => s.text), ["Hello!"]);
    assertEquals(traceOf(open.sent[0]).guardrail, { decision: "error", error: "timeout" });

    const closed = fake({ turn: withGuardrails({ ...MODEL_ON, on_model_error: "handoff" }) });
    closed.deps.guardrail = () => Promise.reject(new AiError("provider", "bad letter"));
    await runBot(closed.deps, "p1", "u1", 1);
    assertEquals(closed.handoffs, [["bot_error", { guardrail_error: "provider" }]]);
    assertEquals(closed.prompts.length, 0);
  }));

Deno.test("guardrail logs the decision only, never the customer text", async () => {
  const lines: string[] = [];
  const { log, error } = console;
  console.log = console.error = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    const f = fake({ turn: { ...withGuardrails(MODEL_ON), newCustomerTexts: ["secret complaint text"] } });
    f.deps.guardrail = decided("normal");
    await runBot(f.deps, "p1", "u1", 1);
    const failing = fake({ turn: { ...withGuardrails(MODEL_ON), newCustomerTexts: ["secret complaint text"] } });
    failing.deps.guardrail = () => Promise.reject(new AiError("auth", "rejected"));
    await runBot(failing.deps, "p1", "u1", 1);
  } finally {
    Object.assign(console, { log, error });
  }
  const guardrailLines = lines.filter((l) => l.includes('"event":"guardrail"'));
  assertEquals(guardrailLines.length, 2);
  assertEquals(lines.some((l) => l.includes("secret complaint text")), false);
});

Deno.test("guardrailState: earlier messages without the texts this turn answers; staff counts as the bot side", () => {
  const turn = {
    history: [
      { sender_kind: "user", text: "hi" },
      { sender_kind: "bot", text: "hello" },
      { sender_kind: "system", text: null },
      { sender_kind: "admin", text: "staff here" },
      { sender_kind: "user", text: "first" },
      { sender_kind: "user", text: "second" },
    ],
    newCustomerTexts: ["first", "second"],
  } as Turn;
  assertEquals(guardrailState(turn), {
    earlier: [{ from: "customer", text: "hi" }, { from: "bot", text: "hello" }, { from: "bot", text: "staff here" }],
    latest: ["first", "second"],
  });
});

const JOB: Job = {
  title: "Nhân viên bảo vệ",
  company: "A Co",
  location: "Hà Nội",
  salary: "8-10 triệu",
  type: "Full-time",
  url: "https://example.com/job/1",
  similarity: 0.8,
};

Deno.test("job search: matching jobs go under the system prompt and retrieval goes in the trace", () =>
  quiet(async () => {
    const f = fake({ turn: { history: [{ sender_kind: "user", text: "tìm việc bảo vệ Hà Nội" }], newCustomerTexts: ["tìm việc bảo vệ Hà Nội"] } });
    const queries: string[] = [];
    f.deps.searchJobs = (query) => {
      queries.push(query);
      return Promise.resolve({ model: "Vietnamese_Embedding", jobs: [JOB, { ...JOB, title: "Weak match", similarity: MIN_SIMILARITY - 0.01 }] });
    };
    await runBot(f.deps, "p1", "u1", 1);
    assertEquals(queries, ["tìm việc bảo vệ Hà Nội"]);
    const system = f.prompts[0][0].content;
    assertStringIncludes(system, "## Matching jobs");
    assertStringIncludes(system, "1. Nhân viên bảo vệ | A Co | Hà Nội | Lương: 8-10 triệu | Full-time | https://example.com/job/1");
    assertEquals(system.includes("Weak match"), false);
    const retrieval = f.sent[0].sender.kind === "bot" ? f.sent[0].sender.trace?.retrieval as Record<string, unknown> : null;
    assertEquals(retrieval?.model, "Vietnamese_Embedding");
    assertEquals(retrieval?.count, 1);
  }));

Deno.test("job search: no match says so, a failure still replies without jobs", () =>
  quiet(async () => {
    const none = fake();
    none.deps.searchJobs = () => Promise.resolve({ model: "m", jobs: [] });
    await runBot(none.deps, "p1", "u1", 1);
    assertStringIncludes(none.prompts[0][0].content, "No job in the system matches");

    const broken = fake();
    broken.deps.searchJobs = () => Promise.reject(new AiError("auth", "API key rejected"));
    await runBot(broken.deps, "p1", "u1", 1);
    assertEquals(broken.sent.length, 1);
    assertEquals(broken.sent[0].text, "Hello!");
    assertStringIncludes(broken.prompts[0][0].content, "job search is unavailable");
    const trace = broken.sent[0].sender.kind === "bot" ? broken.sent[0].sender.trace : undefined;
    assertEquals((trace?.retrieval as Record<string, unknown>).error, "auth");
    assertEquals(broken.handoffs, []);
  }));

Deno.test("findJobs: no search wired adds no section; a slow search times out", async () => {
  assertEquals(await findJobs(undefined, "x"), { jobs: undefined });
  assertEquals(buildPrompt(SETTINGS, "P", [{ sender_kind: "user", text: "hi" }])[0].content.includes("Matching jobs"), false);
  // Real timers: the search never settles, so the 5 s timeout fires.
  const found = await quiet(() => findJobs(() => new Promise(() => {}), "x"));
  assertEquals(found.jobs, null);
  assertEquals((found.retrieval as Record<string, unknown>).error, "timeout");
});

Deno.test("jobQuery: this turn plus two earlier customer messages, newest kept", () => {
  const history = [
    { sender_kind: "user", text: "a" },
    { sender_kind: "user", text: "b" },
    { sender_kind: "bot", text: "reply" },
    { sender_kind: "user", text: "c" },
    { sender_kind: "user", text: "d" },
  ] as const;
  assertEquals(jobQuery([...history], ["d"]), "b\nc\nd");
  assertEquals(jobQuery([{ sender_kind: "user", text: "x".repeat(2_000) }], ["x"]).length, 1_000);
});
