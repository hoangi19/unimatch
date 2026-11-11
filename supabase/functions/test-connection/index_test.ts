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

Deno.test("CORS preflight is answered without auth", async () => {
  const res = await handle(new Request("http://localhost/test-connection", { method: "OPTIONS" }), deps());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});
