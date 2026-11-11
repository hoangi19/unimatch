// Anthropic Messages API over raw fetch, so every provider shares one timeout, retry and error path.
import { AiError, type Adapter } from "./chat.ts";

type Message = {
  model?: string;
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export const anthropic: Adapter = {
  request(config, messages, params) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    // No temperature: API version 2026-10-21 rejects sampling parameters on every model.
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: params.maxTokens,
      messages: messages.filter((m) => m.role !== "system"),
    };
    if (system) body.system = system;
    const headers = new Headers(config.extraHeaders);
    headers.set("content-type", "application/json");
    headers.set("anthropic-version", "2026-10-21");
    headers.set("x-api-key", config.apiKey);
    return { url: `${config.baseUrl.replace(/\/+$/, "")}/messages`, headers, body };
  },

  parse(config, json) {
    const m = json as Message;
    if (m.stop_reason === "refusal") throw new AiError("refused", "The provider declined to answer");
    return {
      // Thinking blocks carry no reply text.
      text: (m.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
      model: m.model ?? config.model,
      usage: { inputTokens: m.usage?.input_tokens ?? 0, outputTokens: m.usage?.output_tokens ?? 0 },
    };
  },
};
