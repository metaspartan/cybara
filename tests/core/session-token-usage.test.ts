import { describe, expect, test } from "bun:test";
import { summarizeSessionTokenUsage } from "../../src/core/session-context";
import { trackTokenUsage } from "../../src/core/llm/token-usage-tracking";

describe("session token usage", () => {
  test("persists cache usage and the latest first-token latency", () => {
    const sessionId = `session-usage-${crypto.randomUUID()}`;
    trackTokenUsage("model-a", "provider-a", "https://provider.test", 100, 20, 2000, {
      sessionId,
      cachedInputTokens: 40,
      cacheWriteTokens: 10,
      firstTokenMs: 1000,
      generationDurationMs: 1000,
    });
    trackTokenUsage("model-a", "provider-a", "https://provider.test", 80, 30, 1000, {
      sessionId,
      cachedInputTokens: 20,
      cacheWriteTokens: 5,
      firstTokenMs: 500,
      generationDurationMs: 500,
    });

    expect(summarizeSessionTokenUsage(sessionId)).toEqual({
      inputTokens: 180,
      outputTokens: 50,
      cachedInputTokens: 60,
      cacheWriteTokens: 15,
      cacheHitRate: 33.3,
      totalTokens: 230,
      callCount: 2,
      durationMs: 3000,
      tokensPerSecond: 33.33,
      firstTokenMs: 500,
      source: "metrics",
    });
  });

  test("does not invent a cache hit rate for providers with exclusive cache counts", () => {
    const sessionId = `session-cache-exclusive-${crypto.randomUUID()}`;
    trackTokenUsage("model-b", "provider-b", "https://provider.test", 40, 10, 500, {
      sessionId,
      cachedInputTokens: 60,
      firstTokenMs: 100,
    });

    const usage = summarizeSessionTokenUsage(sessionId);
    expect(usage.cachedInputTokens).toBe(60);
    expect(usage.cacheHitRate).toBeNull();
  });

  test("does not infer generation speed or TTFT from non-streaming latency", () => {
    const sessionId = `session-non-stream-${crypto.randomUUID()}`;
    trackTokenUsage("model-c", "provider-c", "https://provider.test", 80, 20, 1000, {
      sessionId,
    });

    const usage = summarizeSessionTokenUsage(sessionId);
    expect(usage.durationMs).toBe(1000);
    expect(usage.tokensPerSecond).toBeNull();
    expect(usage.firstTokenMs).toBeNull();
  });
});
