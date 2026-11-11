import { assertEquals } from "jsr:@std/assert@1.0.6";
import { AiError, type ChatMessage, type ChatResult, type ProviderConfig } from "../_shared/ai/chat.ts";
import { type Deps, handle, type TestChatRequest } from "./handler.ts";

const SAVED_URL = "https://api.example.com/v1";
const KEY = "saved-placeholder-key";

const BODY: TestChatRequest = {
  settings: {
    system_prompt: "You help candidates of {{page_name}}.",
    temperature: 0.4,
    max_tokens: 256,
    language: "vi",
    handoff_message: "A person will reply soon.",
    guardrails: { handoff_on_keyword: true },
  },
  provider: { kind: "hermes", base_url: SAVED_URL, model: "draft-model", extra_headers: { "X-Title": "UniMatch" } },
  page: { name: "UniMatch", handoff_keywords: ["gap nguoi that"] },
  messages: [{ role: "user", text: "Có việc data ở HCM không?" }],
};

function deps(overrides: Partial<Deps> = {}) {
  const calls: { config: ProviderConfig; messages: ChatMessage[] }[] = [];
  const d: Deps = {
    getUser: (token) => Promise.resolve(token === "admin-token" ? { app_metadata: { role: "admin" } } : token === "user-token" ? { app_metadata: {} } : null),
    loadBaseUrl: () => Promise.resolve(SAVED_URL),
    loadKey: () => Promise.resolve(KEY),
    chat: (config, messages) => {
      calls.push({ config, messages });
      return Promise.resolve<ChatResult>({ text: "  Có ạ.  ", model: "draft-model", usage: { inputTokens: 30, outputTokens: 4 }, latencyMs: 120 });
    },
    ...overrides,
  };
  return { d, calls };
}

function post(token: string | null, body: unknown = BODY) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/test-chat", { method: "POST", headers, body: JSON.stringify(body) });
}

const withBody = (patch: (b: TestChatRequest) => void) => {
  const b = structuredClone(BODY);
  patch(b);
  return b;
};

Deno.test("no token is 401, non-admin is 403, neither calls the provider", async () => {
  const { d, calls } = deps();
  assertEquals((await handle(post(null), d)).status, 401);
  assertEquals((await handle(post("forged"), d)).status, 401);
  assertEquals((await handle(post("user-token"), d)).status, 403);
  assertEquals(calls.length, 0);
});

Deno.test("admin gets the reply and the trace, with the draft config and the saved key", async () => {
  const { d, calls } = deps();
  const res = await handle(post("admin-token"), d);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, {
    ok: true,
    text: "Có ạ.",
    trace: { provider: "hermes", model: "draft-model", latencyMs: 120, tokens: { inputTokens: 30, outputTokens: 4 }, handoff: null },
  });
  assertEquals(JSON.stringify(body).includes(KEY), false);
  assertEquals(calls[0].config.apiKey, KEY);
  assertEquals(calls[0].config.model, "draft-model");
  assertEquals(calls[0].config.extraHeaders, { "X-Title": "UniMatch" });
  assertEquals(calls[0].messages[0].content, "You help candidates of UniMatch.\n\nAlways reply in Vietnamese.");
  assertEquals(calls[0].messages.slice(1), [{ role: "user", content: "Có việc data ở HCM không?" }]);
});

Deno.test("a draft base URL other than the saved one is refused before the key is read", async () => {
  let keyReads = 0;
  const { d, calls } = deps({ loadKey: () => (keyReads++, Promise.resolve(KEY)) });
  const res = await handle(post("admin-token", withBody((b) => (b.provider.base_url = "https://evil.example.com/v1"))), d);
  assertEquals(await res.json(), { ok: false, error: { kind: "bad_config", message: "Save the base URL before testing" } });
  assertEquals([keyReads, calls.length], [0, 0]);
});

Deno.test("no saved key is bad_config", async () => {
  const { d, calls } = deps({ loadKey: () => Promise.reject(new AiError("bad_config", "No API key saved for this provider")) });
  const res = await handle(post("admin-token"), d);
  assertEquals(await res.json(), { ok: false, error: { kind: "bad_config", message: "No API key saved for this provider" } });
  assertEquals(calls.length, 0);
});

Deno.test("a handoff keyword in the latest customer turn returns the handoff message without calling the AI", async () => {
  const { d, calls } = deps();
  const body = withBody((b) => b.messages.push({ role: "bot", text: "Có ạ." }, { role: "user", text: "Cho mình GẶP NGƯỜI THẬT!" }));
  assertEquals(await (await handle(post("admin-token", body), d)).json(), {
    ok: true,
    text: "A person will reply soon.",
    trace: { provider: "hermes", handoff: { reason: "keyword", keyword: "gap nguoi that" } },
  });
  assertEquals(calls.length, 0);
});

Deno.test("the keyword check skips older turns and respects the guardrail toggle", async () => {
  const { d, calls } = deps();
  const older = withBody((b) => b.messages.unshift({ role: "user", text: "gap nguoi that" }, { role: "bot", text: "Dạ" }));
  assertEquals((await (await handle(post("admin-token", older), d)).json()).trace.handoff, null);
  const off = withBody((b) => {
    b.settings.guardrails.handoff_on_keyword = false;
    b.messages[0].text = "gap nguoi that";
  });
  assertEquals((await (await handle(post("admin-token", off), d)).json()).trace.handoff, null);
  assertEquals(calls.length, 2);
});

Deno.test("invalid or unbounded input is 400", async () => {
  const { d, calls } = deps();
  const bad = [
    null,
    withBody((b) => (b.provider.kind = "gemini" as never)),
    withBody((b) => (b.settings.temperature = 3)),
    withBody((b) => (b.settings.max_tokens = 10)),
    withBody((b) => (b.settings.system_prompt = "x".repeat(6001))),
    withBody((b) => (b.messages = [])),
    withBody((b) => (b.messages = Array.from({ length: 41 }, () => ({ role: "user", text: "hi" })))),
    withBody((b) => (b.messages[0].text = "x".repeat(2001))),
    withBody((b) => b.messages.push({ role: "bot", text: "last is bot" })),
    withBody((b) => (b.provider.extra_headers = { "bad header": "x" })),
  ];
  for (const body of bad) assertEquals((await handle(post("admin-token", body), d)).status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("provider errors are ok:false; unexpected errors are 500 with a generic message", async () => {
  const { d } = deps({ chat: () => Promise.reject(new AiError("rate_limit", "Rate limited by the provider, try again later")) });
  assertEquals((await (await handle(post("admin-token"), d)).json()).error.kind, "rate_limit");
  const realError = console.error;
  console.error = () => {};
  try {
    const res = await handle(post("admin-token"), deps({ loadBaseUrl: () => Promise.reject(new Error("db down")) }).d);
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error.message, "Unexpected error");
  } finally {
    console.error = realError;
  }
});


Deno.test("the dry run uses the live job search and shows retrieval in the trace", async () => {
  const queries: string[] = [];
  const { d, calls } = deps({
    searchJobs: (query) => {
      queries.push(query);
      return Promise.resolve({
        model: "Vietnamese_Embedding",
        jobs: [{ title: "Data analyst", company: "A Co", location: "HCM", salary: null, type: null, url: "https://example.com/j", similarity: 0.7 }],
      });
    },
  });
  const body = await (await handle(post("admin-token"), d)).json();
  assertEquals(queries, ["Có việc data ở HCM không?"]);
  assertEquals(body.trace.retrieval.count, 1);
  assertEquals(body.trace.retrieval.model, "Vietnamese_Embedding");
  assertEquals(calls[0].messages[0].content.includes("1. Data analyst | A Co | HCM | https://example.com/j"), true);
});
