// OpenAI-compatible Chat Completions: Hermes (Nous), OpenAI and custom endpoints.
import type { Adapter } from "./chat.ts";

type Completion = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export const openai: Adapter = {
  request(config, messages, params) {
    const body: Record<string, unknown> = { model: config.model, messages };
    if (config.kind === "openai") {
      // GPT-5 models reject max_tokens and any non-default temperature.
      body.max_completion_tokens = params.maxTokens;
    } else {
      body.max_tokens = params.maxTokens;
      if (params.temperature !== undefined) body.temperature = params.temperature;
    }
    const headers = new Headers(config.extraHeaders);
    headers.set("content-type", "application/json");
    headers.set("authorization", `Bearer ${config.apiKey}`);
    return { url: `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, headers, body };
  },

  parse(config, json) {
    const c = json as Completion;
    return {
      text: c.choices?.[0]?.message?.content ?? "",
      model: c.model ?? config.model,
      usage: { inputTokens: c.usage?.prompt_tokens ?? 0, outputTokens: c.usage?.completion_tokens ?? 0 },
    };
  },
};
