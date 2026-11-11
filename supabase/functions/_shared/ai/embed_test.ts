import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1.0.6";
import { AiError } from "./chat.ts";
import { embed, type EmbeddingConfig } from "./embed.ts";

// Fake key, built at runtime so the secret scan does not flag a literal.
const KEY = ["fpt", "test", "0123456789abcdefghijklmnopqrstuvwxyz"].join("-");
const CONFIG: EmbeddingConfig = { baseUrl: "https://mkp.example.com/v1/", model: "Vietnamese_Embedding", dims: 3, apiKey: KEY };

type Call = { url: string; headers: Headers; body: { model: string; input: string[] } };

async function withFetch(respond: (call: Call) => Response, run: (calls: Call[], logs: string[]) => Promise<void>) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    calls.push(call);
    return Promise.resolve(respond(call));
  }) as typeof fetch;
  console.log = (line: string) => logs.push(line);
  try {
    await run(calls, logs);
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
}

const vectors = (call: Call, dims = 3) =>
  Response.json({
    model: "Vietnamese_Embedding",
    // Out of order on purpose: results are matched to inputs by index.
    data: call.body.input.map((_, i) => ({ index: i, embedding: Array(dims).fill(i) })).reverse(),
  });

Deno.test("embed posts the inputs with the bearer key and returns vectors in input order", async () => {
  await withFetch((call) => vectors(call), async (calls, logs) => {
    const result = await embed(CONFIG, ["bảo vệ Hà Nội", "kế toán"]);
    assertEquals(calls[0].url, "https://mkp.example.com/v1/embeddings");
    assertEquals(calls[0].headers.get("authorization"), `Bearer ${KEY}`);
    assertEquals(calls[0].body, { model: "Vietnamese_Embedding", input: ["bảo vệ Hà Nội", "kế toán"] });
    assertEquals(result.vectors, [[0, 0, 0], [1, 1, 1]]);
    // Logs carry counts only: no input text, no key.
    assertEquals(logs.some((l) => l.includes("bảo vệ") || l.includes(KEY)), false);
  });
});

Deno.test("embed rejects vectors of the wrong size as bad_config", async () => {
  await withFetch((call) => vectors(call, 4), async () => {
    const e = await assertRejects(() => embed(CONFIG, ["x"]), AiError);
    assertEquals(e.kind, "bad_config");
    assertStringIncludes(e.message, "4 dims, expected 3");
  });
});

Deno.test("embed maps HTTP errors and never echoes the key", async () => {
  await withFetch(() => Response.json({ error: { message: `bad key ${KEY}` } }, { status: 401 }), async () => {
    const e = await assertRejects(() => embed(CONFIG, ["x"]), AiError);
    assertEquals(e.kind, "auth");
    assertEquals(e.message.includes(KEY), false);
  });
  await withFetch(() => Response.json({ data: [] }), async () => {
    assertEquals((await assertRejects(() => embed(CONFIG, ["x"]), AiError)).kind, "provider");
  });
  await withFetch(() => new Response(null, { status: 302, headers: { location: "https://evil.example.com" } }), async () => {
    assertEquals((await assertRejects(() => embed(CONFIG, ["x"]), AiError)).kind, "bad_config");
  });
});
