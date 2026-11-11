// Admin-only check of the job embedding model: embeds one sample text with the saved config and key,
// and fails when the vector size is not the one job_chunks stores.
import { AiError } from "../_shared/ai/chat.ts";
import type { embed, EmbeddingConfig } from "../_shared/ai/embed.ts";

export type Deps = {
  // Verifies the token with Supabase Auth; null when missing, expired or invalid.
  getUser(token: string): Promise<{ app_metadata?: Record<string, unknown> } | null>;
  loadEmbedding(): Promise<EmbeddingConfig>;
  embed: typeof embed;
};

const SAMPLE = "Tuyển nhân viên bảo vệ tại Hà Nội";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const user = token ? await deps.getUser(token) : null;
  if (!user) return json({ error: "Sign in required" }, 401);
  if (user.app_metadata?.role !== "admin") return json({ error: "Admin only" }, 403);

  try {
    const config = await deps.loadEmbedding();
    const result = await deps.embed(config, [SAMPLE], 15_000);
    return json({ ok: true, model: result.model, dims: result.vectors[0].length, latencyMs: result.latencyMs });
  } catch (e) {
    if (e instanceof AiError) return json({ ok: false, error: { kind: e.kind, message: e.message } });
    console.error("test-embedding failed", e instanceof Error ? e.message : "unknown error");
    return json({ ok: false, error: { kind: "provider", message: "Unexpected error" } }, 500);
  }
}
