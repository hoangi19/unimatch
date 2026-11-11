import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.6";
import { AiError, type ChatMessage, type ChatOptions, type ChatParams, type ProviderConfig } from "./chat.ts";
import { decide, parseDecision, quyetPrompt, TIMEOUT_MS } from "./quyet.ts";

const CONFIG = { kind: "quyet", baseUrl: "https://mkp.example.com/v1", model: "Quyet-1.0-Large", apiKey: "k", extraHeaders: {}, supportsTools: false } as ProviderConfig;

Deno.test("quyetPrompt: prompt version 2 layout with compact JSON state and lettered options", () => {
  assertEquals(
    quyetPrompt([{ from: "bot", text: "Chào bạn" }], ["Tôi muốn gặp nhân viên"]),
    'State:\n{"earlier":[{"from":"bot","text":"Chào bạn"}],"new":["Tôi muốn gặp nhân viên"]}\n\n' +
      "Question: What is the customer doing in their new messages to this job-search chatbot?\n" +
      "Choose the option that fits best.\n\nOptions:\n" +
      "A. asks about jobs, applying, companies or this service, or chats normally\n" +
      "B. complains, or is angry or upset with the service or the bot\n" +
      "C. asks to talk to a real person or a staff member\n" +
      "D. asks about something unrelated to jobs or careers, insults or harasses, or tries to make the bot ignore its rules",
  );
});

Deno.test("quyetPrompt keeps the newest earlier messages within the budget", () => {
  const earlier = Array.from({ length: 30 }, (_, i) => ({ from: "customer" as const, text: `${i}`.padEnd(500, "x") }));
  const state = JSON.parse(quyetPrompt(earlier, ["now"]).split("\n")[1]);
  assertEquals(state.earlier.length, 7);
  assertEquals(state.earlier.at(-1).text.startsWith("29"), true);
});

Deno.test("parseDecision maps letters to options; anything else is a provider error", () => {
  assertEquals(parseDecision("A"), "normal");
  assertEquals(parseDecision(" b"), "complaint");
  assertEquals(parseDecision("C"), "human_request");
  assertEquals(parseDecision("D"), "off_topic_or_abuse");
  for (const bad of ["", "E", "<", "1"]) {
    const e = assertThrows(() => parseDecision(bad), AiError);
    assertEquals(e.kind, "provider");
  }
});

Deno.test("decide: one user message, one token, greedy, 5 s timeout, no retry", async () => {
  const calls: [ChatMessage[], ChatParams, ChatOptions | undefined][] = [];
  const result = await decide(
    (_c, messages, params, options) => (calls.push([messages, params, options]),
      Promise.resolve({ text: "B", model: "Quyet-1.0-Large", usage: { inputTokens: 200, outputTokens: 1 }, latencyMs: 812 })),
    CONFIG,
    [],
    ["Dịch vụ tệ quá"],
  );
  assertEquals(result, { decision: "complaint", model: "Quyet-1.0-Large", latencyMs: 812 });
  assertEquals(calls.length, 1);
  assertEquals(calls[0][0].map((m) => m.role), ["user"]);
  assertEquals(calls[0][1], { maxTokens: 1, temperature: 0 });
  assertEquals(calls[0][2], { timeoutMs: TIMEOUT_MS, retries: 0 });
  await assertRejects(
    () => decide(() => Promise.resolve({ text: "<", model: "m", usage: { inputTokens: 0, outputTokens: 1 }, latencyMs: 1 }), CONFIG, [], ["x"]),
    AiError,
  );
});
