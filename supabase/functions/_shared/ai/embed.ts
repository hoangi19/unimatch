// OpenAI-compatible /embeddings call for the job search model (embedding_model row). No retries: the bot
// turn falls back to "no job search" and scripts re-run. The key only goes into the request header.
import { AiError, errorDetail, redact, statusError } from "./chat.ts";

export type EmbeddingConfig = { baseUrl: string; model: string; dims: number; apiKey: string };
export type Embedded = { vectors: number[][]; model: string; latencyMs: number };

export async function embed(config: EmbeddingConfig, inputs: string[], timeoutMs = 30_000): Promise<Embedded> {
  const started = Date.now();
  const fail = (error: AiError, status?: number) => {
    console.log(JSON.stringify({ event: "ai_embed", model: config.model, inputs: inputs.length, latencyMs: Date.now() - started, status, error: error.kind }));
    return error;
  };
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input: inputs }),
      // A redirect would carry the key to a host the guard never checked.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw fail(new AiError("timeout", `Embedding model did not answer within ${timeoutMs / 1000}s`));
    }
    throw fail(new AiError("provider", "Could not reach the embedding model"));
  }
  if (res.status >= 300 && res.status < 400) {
    throw fail(new AiError("bad_config", "Embedding endpoint redirected the request; set the final URL as the base URL"), res.status);
  }
  if (!res.ok) throw fail(statusError(res.status, redact(errorDetail(text), config.apiKey)), res.status);

  let json: { model?: string; data?: { index?: number; embedding?: unknown }[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw fail(new AiError("provider", "Embedding model returned an invalid response"));
  }
  const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (data.length !== inputs.length || !data.every((d) => Array.isArray(d.embedding) && d.embedding.every(Number.isFinite))) {
    throw fail(new AiError("provider", "Embedding model returned an invalid response"));
  }
  const vectors = data.map((d) => d.embedding as number[]);
  const wrong = vectors.find((v) => v.length !== config.dims);
  if (wrong) throw fail(new AiError("bad_config", `Embedding model returned ${wrong.length} dims, expected ${config.dims}`));
  const latencyMs = Date.now() - started;
  console.log(JSON.stringify({ event: "ai_embed", model: config.model, inputs: inputs.length, latencyMs, status: res.status }));
  return { vectors, model: json.model ?? config.model, latencyMs };
}
