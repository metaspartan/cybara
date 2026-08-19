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

  test("tracks estimated output tokens and real timing when the provider omits usage", () => {
    const sessionId = `no-usage-provider-${crypto.randomUUID()}`;
    trackOpenAIResponseUsage(
      {
        id: "response-no-usage",
        object: "chat.completion",
        model: "custom-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "The importer now handles 4 rows and the schema matches the fixture.",
            },
            finish_reason: "stop",
          },
        ],
        first_token_ms: 320,
        generation_duration_ms: 1250,
      },
      {
        model: "custom-model",
        provider: "custom-provider",
        providerUrl: "https://custom.test/v1",
        durationMs: 2000,
        sessionId,
      }
    );

    const usage = summarizeSessionTokenUsage(sessionId);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBeGreaterThan(0);
    expect(usage.tokensPerSecond).toBeGreaterThan(0);
    expect(usage.firstTokenMs).toBe(320);
  });

  test("records estimated input tokens for no-usage providers", () => {
    const sessionId = `no-usage-input-${crypto.randomUUID()}`;
    trackOpenAIResponseUsage(
      {
        id: "response-no-usage-input",
        object: "chat.completion",
        model: "custom-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "The migration is applied." },
            finish_reason: "stop",
          },
        ],
        first_token_ms: 250,
        generation_duration_ms: 900,
      },
      {
        model: "custom-model",
        provider: "custom-provider",
        providerUrl: "https://custom.test/v1",
        durationMs: 1500,
        sessionId,
        inputTokens: 52000,
      }
    );

    const usage = summarizeSessionTokenUsage(sessionId);
    expect(usage.inputTokens).toBe(52000);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBeGreaterThan(52000);
    expect(usage.tokensPerSecond).toBeGreaterThan(0);
  });

  test("tracks known input tokens for empty responses so usage is not lost", () => {
    const sessionId = `empty-with-input-${crypto.randomUUID()}`;
    const tracked = trackOpenAIResponseUsage(
      {
        id: "response-empty-input",
        object: "chat.completion",
        model: "custom-model",
        choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
      },
      {
        model: "custom-model",
        provider: "custom-provider",
        providerUrl: "https://custom.test/v1",
        durationMs: 500,
        sessionId,
        inputTokens: 1200,
      }
    );

    expect(tracked).toBe(true);
    const usage = summarizeSessionTokenUsage(sessionId);
    expect(usage.inputTokens).toBe(1200);
    expect(usage.outputTokens).toBe(0);
    expect(usage.totalTokens).toBe(1200);
  });

  test("does not fabricate rows for empty responses without usage or timing", () => {
    const sessionId = `empty-no-usage-${crypto.randomUUID()}`;
    const tracked = trackOpenAIResponseUsage(
      {
        id: "response-empty",
        object: "chat.completion",
        model: "custom-model",
        choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
      },
      {
        model: "custom-model",
        provider: "custom-provider",
        providerUrl: "https://custom.test/v1",
        durationMs: 500,
        sessionId,
      }
    );

    expect(tracked).toBe(false);
    expect(summarizeSessionTokenUsage(sessionId).totalTokens).toBe(0);
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
