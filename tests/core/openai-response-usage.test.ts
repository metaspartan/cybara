import { describe, expect, test } from "bun:test";
import { summarizeSessionTokenUsage } from "../../src/core/session-context";
import { trackOpenAIResponseUsage } from "../../src/core/llm/openai-response-usage";

describe("OpenAI-compatible response usage", () => {
  test("keeps prompt-detail cache tokens inside reported input", () => {
    const sessionId = `openai-usage-${crypto.randomUUID()}`;
    trackOpenAIResponseUsage(
      {
        id: "response-1",
        object: "chat.completion",
        model: "model-a",
        choices: [],
        first_token_ms: 200,
        generation_duration_ms: 800,
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 60 },
        },
      },
      {
        model: "model-a",
        provider: "openai",
        providerUrl: "https://provider.test",
        durationMs: 1000,
        sessionId,
      }
    );

    expect(summarizeSessionTokenUsage(sessionId)).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 60,
      cacheHitRate: 60,
      totalTokens: 120,
      tokensPerSecond: 25,
      firstTokenMs: 200,
    });
  });

  test("does not infer generation speed from first-token latency alone", () => {
    const sessionId = `openai-burst-usage-${crypto.randomUUID()}`;
    trackOpenAIResponseUsage(
      {
        id: "response-burst",
        object: "chat.completion",
        model: "model-burst",
        choices: [],
        first_token_ms: 999,
        generation_duration_ms: 1,
        usage: {
          prompt_tokens: 10,
          completion_tokens: 100,
          total_tokens: 110,
        },
      },
      {
        model: "model-burst",
        provider: "openai",
        providerUrl: "https://provider.test",
        durationMs: 1000,
        sessionId,
      }
    );

    expect(summarizeSessionTokenUsage(sessionId)).toMatchObject({
      tokensPerSecond: null,
      firstTokenMs: 999,
    });
  });

  test("adds Anthropic-style cache fields without fabricating streaming metrics", () => {
    const sessionId = `anthropic-compatible-usage-${crypto.randomUUID()}`;
    trackOpenAIResponseUsage(
      {
        id: "response-2",
        object: "chat.completion",
        model: "model-b",
        choices: [],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 30,
          total_tokens: 130,
          cache_read_input_tokens: 60,
          cache_creation_input_tokens: 20,
        },
      },
      {
        model: "model-b",
        provider: "anthropic-compatible",
        providerUrl: "https://provider.test",
        durationMs: 1000,
        sessionId,
      }
    );

    expect(summarizeSessionTokenUsage(sessionId)).toMatchObject({
      inputTokens: 100,
      outputTokens: 30,
      cachedInputTokens: 60,
      cacheWriteTokens: 20,
      cacheHitRate: 60,
      totalTokens: 130,
      tokensPerSecond: null,
      firstTokenMs: null,
    });
  });
});
