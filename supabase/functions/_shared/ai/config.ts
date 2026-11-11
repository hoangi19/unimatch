// Loads a provider's saved config and its Vault key. `db` must be the service-role client.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { AiError, type ProviderConfig, type ProviderKind } from "./chat.ts";
import { assertPublicHost } from "./host.ts";

export async function loadProvider(db: SupabaseClient, kind: ProviderKind): Promise<ProviderConfig> {
  const { data: row, error } = await db
    .from("ai_providers")
    .select("base_url, model, extra_headers, supports_tools")
    .eq("kind", kind)
    .maybeSingle();
  if (error) throw new Error(`could not load provider ${kind}`);
  if (!row) throw new AiError("bad_config", `Unknown provider: ${kind}`);
  if (!row.base_url || !row.model) throw new AiError("bad_config", "Set a base URL and a model for this provider first");
  await assertPublicHost(row.base_url);

  return {
    kind,
    baseUrl: row.base_url,
    model: row.model,
    apiKey: await loadKey(db, kind),
    extraHeaders: row.extra_headers ?? {},
    supportsTools: row.supports_tools,
  };
}

// The provider's Vault key; bad_config when none is saved.
export async function loadKey(db: SupabaseClient, kind: ProviderKind): Promise<string> {
  const { data: apiKey, error } = await db.rpc("get_provider_key", { p_kind: kind });
  if (error) throw new Error(`could not read the key for provider ${kind}`);
  if (!apiKey) throw new AiError("bad_config", "No API key saved for this provider");
  return apiKey;
}

// The guardrail model's connection (guardrail_model row) and its own Vault key; bad_config when no key is saved.
export async function loadGuardrail(db: SupabaseClient): Promise<ProviderConfig> {
  const { data: row, error } = await db.from("guardrail_model").select("base_url, model").single();
  if (error) throw new Error("could not load the guardrail model");
  await assertPublicHost(row.base_url);
  const { data: apiKey, error: keyError } = await db.rpc("get_guardrail_key");
  if (keyError) throw new Error("could not read the guardrail key");
  if (!apiKey) throw new AiError("bad_config", "No API key saved for the guardrail model");
  return { kind: "quyet", baseUrl: row.base_url, model: row.model, apiKey, extraHeaders: {}, supportsTools: false };
}
