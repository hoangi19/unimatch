import { assertEquals } from "jsr:@std/assert@1.0.6";
import { AiError, type ChatResult, type ProviderConfig } from "../_shared/ai/chat.ts";
import { type Deps, handle } from "./handler.ts";

const PROVIDER: ProviderConfig = {
  kind: "hermes",
  baseUrl: "https://api.example.com/v1",
  model: "hermes-4-70b",
  apiKey: "placeholder",
  extraHeaders: {},
  supportsTools: true,
};

function deps(overrides: Partial<Deps> = {}): Deps & { chatCalls: number } {
  const d = {
    chatCalls: 0,
    getUser: (token: string) => Promise.resolve(token === "admin-token" ? { app_metadata: { role: "admin" } } : token === "user-token" ? { app_metadata: {} } : null),
    loadProvider: () => Promise.resolve(PROVIDER),
    loadGuardrail: () => Promise.resolve({ ...PROVIDER, kind: "quyet" as const, model: "Quyet-1.0-Large" }),
    chat: () => {
      d.chatCalls++;
      return Promise.resolve<ChatResult>({ text: "OK", model: "hermes-4-70b", usage: { inputTokens: 5, outputTokens: 1 }, latencyMs: 42 });
    },
    ...overrides,
  };
  return d;
}

function post(token: string | null, body: unknown = { kind: "hermes" }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/test-connection", { method: "POST", headers, body: JSON.stringify(body) });
}

Deno.test("no token is 401 and never calls the provider", async () => {
  const d = deps();
  const res = await handle(post(null), d);
  assertEquals(res.status, 401);
  assertEquals(d.chatCalls, 0);
});

Deno.test("an invalid token is 401", async () => {
  const d = deps();
  const res = await handle(post("forged-token"), d);
  assertEquals(res.status, 401);
  assertEquals(d.chatCalls, 0);
});

Deno.test("a signed-in non-admin is 403", async () => {
  const d = deps();
  const res = await handle(post("user-token"), d);
  assertEquals(res.status, 403);
  assertEquals(d.chatCalls, 0);
});

Deno.test("admin gets ok, latency and model", async () => {
  const res = await handle(post("admin-token"), deps());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, latencyMs: 42, model: "hermes-4-70b" });
});

Deno.test("an unknown provider kind is 400", async () => {
  const res = await handle(post("admin-token", { kind: "gemini" }), deps());
  assertEquals(res.status, 400);
});

Deno.test("provider errors come back as ok:false with the safe kind and message", async () => {
  const res = await handle(post("admin-token"), deps({ chat: () => Promise.reject(new AiError("auth", "API key rejected by the provider")) }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: false, error: { kind: "auth", message: "API key rejected by the provider" } });
});

Deno.test("unexpected errors are 500 with a generic message", async () => {
  const realError = console.error;
  console.error = () => {};
  try {
    const res = await handle(post("admin-token"), deps({ loadProvider: () => Promise.reject(new Error("db down")) }));
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error.message, "Unexpected error");
  } finally {
    console.error = realError;
  }
});


Deno.test("quyet: returns the decision for the admin's text, or for a sample when none is given", async () => {
  const seen: string[] = [];
  const d = deps({
    chat: (_c, messages) => {
      seen.push(messages[0].content);
      return Promise.resolve<ChatResult>({ text: "B", model: "Quyet-1.0-Large", usage: { inputTokens: 90, outputTokens: 1 }, latencyMs: 700 });
    },
  });
  const res = await handle(post("admin-token", { kind: "quyet", text: "Dịch vụ quá tệ" }), d);
  assertEquals(await res.json(), { ok: true, decision: "complaint", model: "Quyet-1.0-Large", latencyMs: 700 });
  assertEquals(seen[0].includes("Dịch vụ quá tệ"), true);
  assertEquals((await (await handle(post("admin-token", { kind: "quyet" }), d)).json()).ok, true);
});

Deno.test("quyet: bad text is 400; a missing key or a non-letter answer is a typed error", async () => {
  for (const text of ["", "  ", "x".repeat(2001), 5]) {
    assertEquals((await handle(post("admin-token", { kind: "quyet", text }), deps())).status, 400);
  }
  const noKey = deps({ loadGuardrail: () => Promise.reject(new AiError("bad_config", "No API key saved for the guardrail model")) });
  assertEquals((await (await handle(post("admin-token", { kind: "quyet" }), noKey)).json()).error.kind, "bad_config");
  const odd = deps({
    chat: () => Promise.resolve<ChatResult>({ text: "<", model: "m", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 }),
  });
  assertEquals((await (await handle(post("admin-token", { kind: "quyet" }), odd)).json()).error.kind, "provider");
});
