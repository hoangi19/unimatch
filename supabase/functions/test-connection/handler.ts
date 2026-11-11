// Admin-only provider check: sends a tiny prompt with the provider's saved config.
import { AiError, type chat, PROVIDER_KINDS, type ProviderConfig, type ProviderKind } from "../_shared/ai/chat.ts";

export type Deps = {
  // Verifies the token with Supabase Auth; null when missing, expired or invalid.
  getUser(token: string): Promise<{ app_metadata?: Record<string, unknown> } | null>;
  loadProvider(kind: ProviderKind): Promise<ProviderConfig>;
  chat: typeof chat;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const user = token ? await deps.getUser(token) : null;
  if (!user) return json({ error: "Sign in required" }, 401);
  if (user.app_metadata?.role !== "admin") return json({ error: "Admin only" }, 403);

  const kind = (await req.json().catch(() => null))?.kind;
  if (!PROVIDER_KINDS.includes(kind)) return json({ error: "Unknown provider" }, 400);

  try {
    const config = await deps.loadProvider(kind);
    const result = await deps.chat(config, [{ role: "user", content: "Reply with OK." }], { maxTokens: 64 }, {
      timeoutMs: 15_000,
      retries: 0,
    });
    return json({ ok: true, latencyMs: result.latencyMs, model: result.model });
  } catch (e) {
    if (e instanceof AiError) return json({ ok: false, error: { kind: e.kind, message: e.message } });
    console.error("test-connection failed", e instanceof Error ? e.message : "unknown error");
    return json({ ok: false, error: { kind: "provider", message: "Unexpected error" } }, 500);
  }
}
