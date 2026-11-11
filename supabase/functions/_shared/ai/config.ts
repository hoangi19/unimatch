// Loads a provider's saved config and its Vault key. `db` must be the service-role client.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { AiError, type ProviderConfig, type ProviderKind } from "./chat.ts";

export async function loadProvider(db: SupabaseClient, kind: ProviderKind): Promise<ProviderConfig> {
  const { data: row, error } = await db
    .from("ai_providers")
    .select("base_url, model, extra_headers, supports_tools")
    .eq("kind", kind)
    .maybeSingle();
  if (error) throw new Error(`could not load provider ${kind}`);
  if (!row) throw new AiError("bad_config", `Unknown provider: ${kind}`);
  if (!row.base_url || !row.model) throw new AiError("bad_config", "Set a base URL and a model for this provider first");

  const { data: apiKey, error: keyError } = await db.rpc("get_provider_key", { p_kind: kind });
  if (keyError) throw new Error(`could not read the key for provider ${kind}`);
  if (!apiKey) throw new AiError("bad_config", "No API key saved for this provider");

  return {
    kind,
    baseUrl: row.base_url,
    model: row.model,
    apiKey,
    extraHeaders: row.extra_headers ?? {},
    supportsTools: row.supports_tools,
  };
}
