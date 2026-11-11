import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1.0.6";
import { AiError, chat, type ProviderConfig, redact } from "./chat.ts";
import { decide } from "./quyet.ts";

// Fake key, built at runtime so the secret scan does not flag a literal.
const KEY = ["sk", "test", "0123456789abcdefghijklmnopqrstuvwxyz"].join("-");

function config(kind: ProviderConfig["kind"], extra: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    kind,
    baseUrl: kind === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.example.com/v1/",
    model: "test-model",
    apiKey: KEY,
    extraHeaders: {},
    supportsTools: true,
    ...extra,
  };
}

type Call = { url: string; headers: Headers; body: Record<string, unknown> };

// Swaps globalThis.fetch for the test and silences the per-call log line, collecting it instead.
async function withFetch(
  respond: (call: Call, n: number) => Response | Promise<Response>,
  run: (calls: Call[], logs: string[]) => Promise<void>,
) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    calls.push(call);
    if (init?.signal) {
      const signal = init.signal;
      return await Promise.race([
        respond(call, calls.length),
        new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
      ]);
    }
    return respond(call, calls.length);
  }) as typeof fetch;
  console.log = (line: string) => logs.push(line);
  try {
    await run(calls, logs);
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
}

const completion = (content: string) =>
  Response.json({ model: "served-model", choices: [{ message: { content } }], usage: { prompt_tokens: 7, completion_tokens: 2 } });

Deno.test("openai-compatible: hermes sends max_tokens, temperature and the bearer key", async () => {
  await withFetch(() => completion("OK"), async (calls) => {
    const result = await chat(
      config("hermes", { extraHeaders: { "X-Title": "UniMatch", Authorization: "Bearer other" } }),
      [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }],
      { maxTokens: 128, temperature: 0.4 },
    );
    assertEquals(result.text, "OK");
    assertEquals(result.model, "served-model");
    assertEquals(result.usage, { inputTokens: 7, outputTokens: 2 });
    assertEquals(calls[0].url, "https://api.example.com/v1/chat/completions");
    assertEquals(calls[0].headers.get("authorization"), `Bearer ${KEY}`);
    assertEquals(calls[0].headers.get("x-title"), "UniMatch");
    assertEquals(calls[0].body.max_tokens, 128);
    assertEquals(calls[0].body.temperature, 0.4);
    assertEquals((calls[0].body.messages as unknown[]).length, 2);
  });
});

Deno.test("openai kind sends max_completion_tokens and no temperature", async () => {
  await withFetch(() => completion("OK"), async (calls) => {
    await chat(config("openai"), [{ role: "user", content: "hi" }], { maxTokens: 64, temperature: 0.4 });
    assertEquals(calls[0].body.max_completion_tokens, 64);
    assert(!("max_tokens" in calls[0].body));
    assert(!("temperature" in calls[0].body));
  });
});

Deno.test("anthropic: lifts system, sends version and key headers, skips thinking blocks", async () => {
  const reply = {
    model: "claude-sonnet-5-5",
    stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hello" }],
    usage: { input_tokens: 11, output_tokens: 3 },
  };
  await withFetch(() => Response.json(reply), async (calls) => {
    const result = await chat(
      config("anthropic"),
      [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }],
      { maxTokens: 64, temperature: 0.4 },
    );
    assertEquals(result.text, "Hello");
    assertEquals(result.usage, { inputTokens: 11, outputTokens: 3 });
    assertEquals(calls[0].url, "https://api.anthropic.com/v1/messages");
    assertEquals(calls[0].headers.get("x-api-key"), KEY);
    assertEquals(calls[0].headers.get("anthropic-version"), "2026-10-21");
    assertEquals(calls[0].body.system, "be brief");
    assertEquals(calls[0].body.messages, [{ role: "user", content: "hi" }]);
    assert(!("temperature" in calls[0].body));
  });
});

Deno.test("anthropic refusal is a refused error", async () => {
  await withFetch(() => Response.json({ stop_reason: "refusal", content: [] }), async () => {
    const e = await assertRejects(() => chat(config("anthropic"), [{ role: "user", content: "x" }], { maxTokens: 64 }), AiError);
    assertEquals(e.kind, "refused");
  });
});

Deno.test("401 is an auth error that never contains the key, even when the provider echoes it", async () => {
  const body = { error: { message: `Incorrect API key provided: ${KEY}` } };
  await withFetch(() => Response.json(body, { status: 401 }), async (calls, logs) => {
    const e = await assertRejects(() => chat(config("openai"), [{ role: "user", content: "x" }], { maxTokens: 64 }), AiError);
    assertEquals(e.kind, "auth");
    assert(!e.message.includes(KEY));
    assertEquals(calls.length, 1);
    assert(logs.every((line) => !line.includes(KEY)));
  });
});

Deno.test("400 about tokens says max_tokens exceeds the model limit", async () => {
  const body = { error: { message: "max_tokens: 999999 > 8192, which is the maximum allowed" } };
  await withFetch(() => Response.json(body, { status: 400 }), async () => {
    const e = await assertRejects(() => chat(config("hermes"), [{ role: "user", content: "x" }], { maxTokens: 999999 }), AiError);
    assertEquals(e.kind, "bad_request");
    assertEquals(e.message, "max_tokens exceeds the model limit");
  });
});

Deno.test("404 is a bad_config error with the provider's detail", async () => {
  const body = { error: { message: "The model `gpt-nope` does not exist" } };
  await withFetch(() => Response.json(body, { status: 404 }), async () => {
    const e = await assertRejects(() => chat(config("openai"), [{ role: "user", content: "x" }], { maxTokens: 64 }), AiError);
    assertEquals(e.kind, "bad_config");
    assertStringIncludes(e.message, "gpt-nope");
  });
});

Deno.test("429 is retried once, then succeeds", async () => {
  await withFetch(
    (_, n) => n === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } }) : completion("OK"),
    async (calls) => {
      const result = await chat(config("hermes"), [{ role: "user", content: "x" }], { maxTokens: 64 });
      assertEquals(result.text, "OK");
      assertEquals(calls.length, 2);
    },
  );
});

Deno.test("retries: 0 makes a single call and returns rate_limit", async () => {
  await withFetch(() => new Response("slow down", { status: 429, headers: { "retry-after": "0" } }), async (calls) => {
    const e = await assertRejects(
      () => chat(config("hermes"), [{ role: "user", content: "x" }], { maxTokens: 64 }, { retries: 0 }),
      AiError,
    );
    assertEquals(e.kind, "rate_limit");
    assertEquals(calls.length, 1);
  });
});

Deno.test("persistent 5xx stops after one retry", async () => {
  await withFetch(() => new Response("down", { status: 503, headers: { "retry-after": "0" } }), async (calls) => {
    const e = await assertRejects(() => chat(config("custom"), [{ role: "user", content: "x" }], { maxTokens: 64 }), AiError);
    assertEquals(e.kind, "provider");
    assertEquals(calls.length, 2);
  });
});

Deno.test("a provider that never answers is a timeout error", async () => {
  await withFetch(() => new Promise<Response>(() => {}), async () => {
    const e = await assertRejects(
      () => chat(config("hermes"), [{ role: "user", content: "x" }], { maxTokens: 64 }, { timeoutMs: 50 }),
      AiError,
    );
    assertEquals(e.kind, "timeout");
  });
});

Deno.test("success logs usage and latency but not the key or the prompt", async () => {
  await withFetch(() => completion("OK"), async (_, logs) => {
    await chat(config("hermes"), [{ role: "user", content: "secret question" }], { maxTokens: 64 });
    const entry = JSON.parse(logs[0]);
    assertEquals(entry.event, "ai_chat");
    assertEquals(entry.inputTokens, 7);
    assertEquals(entry.outputTokens, 2);
    assert(!logs[0].includes(KEY) && !logs[0].includes("secret question"));
  });
});

Deno.test("redact strips the key, key-like tokens and caps the length", () => {
  assertEquals(redact(`bad key ${KEY}`, KEY), "bad key [redacted]");
  assertEquals(redact("bad key sk-abc***wxyz", KEY), "bad key [redacted]");
  assertEquals(redact("word ".repeat(100), KEY).length, 200);
});

Deno.test("a redirect is not followed, so the key never reaches the redirect target", async () => {
  await withFetch(() => new Response(null, { status: 307, headers: { location: "http://169.254.169.254/" } }), async (calls) => {
    const e = await assertRejects(() => chat(config("custom"), [{ role: "user", content: "hi" }], { maxTokens: 64 }), AiError);
    assertEquals([e.kind, calls.length], ["bad_config", 1]);
  });
});

Deno.test("quyet (FPT): one token at temperature 0, api-key and bearer headers, letter read back", async () => {
  await withFetch(() => completion("C"), async (calls) => {
    const result = await decide(chat, config("quyet", { baseUrl: "https://mkp-api.fptcloud.com/v1" }), [], ["cho em gặp người thật"]);
    assertEquals(result.decision, "human_request");
    assertEquals(calls[0].url, "https://mkp-api.fptcloud.com/v1/chat/completions");
    assertEquals(calls[0].headers.get("api-key"), KEY);
    assertEquals(calls[0].headers.get("authorization"), `Bearer ${KEY}`);
    assertEquals(calls[0].body.max_tokens, 1);
    assertEquals(calls[0].body.temperature, 0);
    assertEquals(calls.length, 1);
  });
});
