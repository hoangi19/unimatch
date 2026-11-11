// Provider-neutral chat call: one request in, text + usage + latency out, typed errors.
// The API key only ever goes into a request header: never into logs, results or error messages.
import { anthropic } from "./anthropic.ts";
import { openai } from "./openai.ts";

export const PROVIDER_KINDS = ["hermes", "openai", "anthropic", "custom"] as const;
export type ProviderKind = typeof PROVIDER_KINDS[number];

export type ProviderConfig = {
  // "quyet" is the guardrail model (its own table), never a reply provider.
  kind: ProviderKind | "quyet";
  baseUrl: string;
  model: string;
  apiKey: string;
  extraHeaders: Record<string, string>;
  supportsTools: boolean;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatParams = { maxTokens: number; temperature?: number };
export type ChatOptions = { timeoutMs?: number; retries?: number };
export type Usage = { inputTokens: number; outputTokens: number };
export type ChatResult = { text: string; model: string; usage: Usage; latencyMs: number };

export type AiErrorKind = "auth" | "rate_limit" | "timeout" | "bad_config" | "bad_request" | "provider" | "refused";

export class AiError extends Error {
  constructor(readonly kind: AiErrorKind, message: string) {
    super(message);
    this.name = "AiError";
  }
}

export type Adapter = {
  request(config: ProviderConfig, messages: ChatMessage[], params: ChatParams): { url: string; headers: Headers; body: unknown };
  parse(config: ProviderConfig, json: unknown): { text: string; model: string; usage: Usage };
};

const MAX_RETRY_WAIT_MS = 2_000;

export async function chat(
  config: ProviderConfig,
  messages: ChatMessage[],
  params: ChatParams,
  { timeoutMs = 30_000, retries = 1 }: ChatOptions = {},
): Promise<ChatResult> {
  const adapter = config.kind === "anthropic" ? anthropic : openai;
  const { url, headers, body } = adapter.request(config, messages, params);
  const started = Date.now();
  const deadline = started + timeoutMs;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        // A redirect would carry the key to a host the guard never checked.
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)),
      });
      text = await res.text();
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        throw logged(config, started, new AiError("timeout", `Provider did not answer within ${timeoutMs / 1000}s`));
      }
      if (attempt < retries && Date.now() + 500 < deadline) {
        await sleep(500);
        continue;
      }
      throw logged(config, started, new AiError("provider", "Could not reach the provider"));
    }

    if (res.status >= 300 && res.status < 400) {
      throw logged(config, started, new AiError("bad_config", "Provider redirected the request; set the final URL as the base URL"), res.status);
    }
    if (res.ok) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw logged(config, started, new AiError("provider", "Provider returned an invalid response"));
      }
      let parsed;
      try {
        parsed = adapter.parse(config, json);
      } catch (e) {
        throw logged(config, started, e instanceof AiError ? e : new AiError("provider", "Provider returned an invalid response"));
      }
      const result = { ...parsed, latencyMs: Date.now() - started };
      log(config, started, { status: res.status, ...result.usage });
      return result;
    }

    const wait = retryWaitMs(res.headers.get("retry-after"));
    if ((res.status === 429 || res.status >= 500) && attempt < retries && Date.now() + wait < deadline) {
      await sleep(wait);
      continue;
    }
    throw logged(config, started, statusError(res.status, redact(errorDetail(text), config.apiKey)), res.status);
  }
}

export function statusError(status: number, detail: string): AiError {
  if (status === 401 || status === 403) return new AiError("auth", "API key rejected by the provider");
  if (status === 429) return new AiError("rate_limit", "Rate limited by the provider, try again later");
  if (status === 404) return new AiError("bad_config", `Model or endpoint not found${detail ? `: ${detail}` : ""}`);
  if (status === 400 || status === 422) {
    if (/max_(completion_)?tokens|maximum.*tokens|tokens.*(limit|maximum)/i.test(detail)) {
      return new AiError("bad_request", "max_tokens exceeds the model limit");
    }
    return new AiError("bad_request", `Provider rejected the request${detail ? `: ${detail}` : ""}`);
  }
  return new AiError("provider", `Provider error (HTTP ${status})`);
}

export function errorDetail(text: string): string {
  try {
    const json = JSON.parse(text);
    const message = json?.error?.message ?? json?.message ?? json?.error;
    return typeof message === "string" ? message : "";
  } catch {
    return text;
  }
}

// Provider messages can echo the key (whole or masked), so strip anything key-like before showing them.
export function redact(detail: string, apiKey: string): string {
  return detail
    .split(apiKey).join("[redacted]")
    .replace(/\b(?:sk|nous|key)-\S*/gi, "[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, 200);
}

function retryWaitMs(header: string | null): number {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_WAIT_MS) : 500;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(config: ProviderConfig, started: number, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: "ai_chat", provider: config.kind, model: config.model, latencyMs: Date.now() - started, ...fields }));
}

function logged(config: ProviderConfig, started: number, error: AiError, status?: number): AiError {
  log(config, started, { status, error: error.kind });
  return error;
}
