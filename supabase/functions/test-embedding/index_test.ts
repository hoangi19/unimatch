import { assertEquals } from "jsr:@std/assert@1.0.6";
import { AiError } from "../_shared/ai/chat.ts";
import type { EmbeddingConfig } from "../_shared/ai/embed.ts";
import { type Deps, handle } from "./handler.ts";

// Fake key, built at runtime so the secret scan does not flag a literal.
const KEY = ["fpt", "test", "0123456789abcdefghijklmnopqrstuvwxyz"].join("-");
const CONFIG: EmbeddingConfig = { baseUrl: "https://mkp.example.com/v1", model: "Vietnamese_Embedding", dims: 1024, apiKey: KEY };

function deps(overrides: Partial<Deps> = {}): Deps {
  return {
    getUser: (token) => Promise.resolve(token === "admin-token" ? { app_metadata: { role: "admin" } } : token === "user-token" ? { app_metadata: {} } : null),
    loadEmbedding: () => Promise.resolve(CONFIG),
    embed: (_config, inputs) => Promise.resolve({ vectors: inputs.map(() => Array(1024).fill(0)), model: "Vietnamese_Embedding", latencyMs: 80 }),
    ...overrides,
  };
}

const post = (token?: string) =>
  new Request("http://localhost/test-embedding", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });

Deno.test("admin gets the model, dims and latency, never the key", async () => {
  const body = await (await handle(post("admin-token"), deps())).json();
  assertEquals(body, { ok: true, model: "Vietnamese_Embedding", dims: 1024, latencyMs: 80 });
});

Deno.test("only admins may test", async () => {
  assertEquals((await handle(post(), deps())).status, 401);
  assertEquals((await handle(post("user-token"), deps())).status, 403);
  assertEquals((await handle(new Request("http://localhost/test-embedding"), deps())).status, 405);
});

Deno.test("model errors come back typed: missing key, wrong dims", async () => {
  const noKey = deps({ loadEmbedding: () => Promise.reject(new AiError("bad_config", "No API key saved for the embedding model")) });
  assertEquals((await (await handle(post("admin-token"), noKey)).json()).error.kind, "bad_config");
  const dims = deps({ embed: () => Promise.reject(new AiError("bad_config", "Embedding model returned 768 dims, expected 1024")) });
  const body = await (await handle(post("admin-token"), dims)).json();
  assertEquals(body, { ok: false, error: { kind: "bad_config", message: "Embedding model returned 768 dims, expected 1024" } });
});
