import { describe, expect, test } from "bun:test";
import { readAgentContextWindowTokens } from "../../src/core/agent-internals";
import { resolveTurnContextWindow } from "../../src/api/chat-turn-context";
import {
  estimateMessagesRequestVisibleTokens,
  shouldCompactContext,
  type ChatMessage,
} from "../../src/core/session-context";
import { tables } from "../../src/core/database";

describe("agent max context window config", () => {
  test("reads snake_case and camelCase max context token keys", () => {
    expect(readAgentContextWindowTokens({ max_context_tokens: 128000 })).toBe(128000);
    expect(readAgentContextWindowTokens({ maxContextTokens: 64000 })).toBe(64000);
    expect(readAgentContextWindowTokens({ context_window_tokens: 32000 })).toBe(32000);
    expect(readAgentContextWindowTokens({ contextWindowTokens: 16000 })).toBe(16000);
  });

  test("parses JSON string configs", () => {
    expect(readAgentContextWindowTokens(JSON.stringify({ max_context_tokens: 8192 }))).toBe(8192);
  });

  test("floors fractional values and rejects invalid inputs", () => {
    expect(readAgentContextWindowTokens({ max_context_tokens: 1000.9 })).toBe(1000);
    expect(readAgentContextWindowTokens({})).toBeUndefined();
    expect(readAgentContextWindowTokens(null)).toBeUndefined();
    expect(readAgentContextWindowTokens(undefined)).toBeUndefined();
    expect(readAgentContextWindowTokens("not json")).toBeUndefined();
    expect(readAgentContextWindowTokens({ max_context_tokens: 0 })).toBeUndefined();
    expect(readAgentContextWindowTokens({ max_context_tokens: -500 })).toBeUndefined();
    expect(readAgentContextWindowTokens({ max_context_tokens: "128000" })).toBeUndefined();
    expect(readAgentContextWindowTokens({ max_context_tokens: Number.NaN })).toBeUndefined();
  });

  test("prefers explicit max context over fallback keys", () => {
    expect(
      readAgentContextWindowTokens({
        max_context_tokens: 128000,
        maxContextTokens: 64000,
      })
    ).toBe(128000);
  });
});

describe("turn context window resolution", () => {
  test("uses the provider-scoped model window when the provider lists the model", () => {
    const providerId = `provider-window-${crypto.randomUUID()}`;
    const modelId = "custom-flash-0731";
    try {
      tables.providers.create({
        id: providerId,
        provider: "inference",
        name: "Test Inference",
        base_url: "https://test.invalid/v1",
        is_default: false,
      });
      tables.providerModels.upsert({
        id: `pm-${crypto.randomUUID()}`,
        provider_id: providerId,
        model_id: modelId,
        model_name: modelId,
        context_window: 786432,
        max_tokens: 65536,
        reasoning: false,
        input_types: ["text"],
        cost_input: 0,
        cost_output: 0,
        cost_cache_read: 0,
        cost_cache_write: 0,
      });
      const resolved = resolveTurnContextWindow(
        { config: {}, provider_id: providerId, model: modelId },
        modelId
      );
      expect(resolved.contextWindow).toBe(786432);
      expect(resolved.contextWindowTokens).toBe(786432);
    } finally {
      tables.providerModels.deleteByProvider(providerId);
      tables.providers.delete(providerId);
    }
  });

  test("ignores provider_models rows without a matching model", () => {
    const providerId = `provider-nomatch-${crypto.randomUUID()}`;
    try {
      tables.providers.create({
        id: providerId,
        provider: "inference",
        name: "Test Inference",
        base_url: "https://test.invalid/v1",
        is_default: false,
      });
      tables.providerModels.upsert({
        id: `pm-${crypto.randomUUID()}`,
        provider_id: providerId,
        model_id: "some-other-model",
        model_name: "some-other-model",
        context_window: 999999,
        max_tokens: 65536,
        reasoning: false,
        input_types: ["text"],
        cost_input: 0,
        cost_output: 0,
        cost_cache_read: 0,
        cost_cache_write: 0,
      });
      const resolved = resolveTurnContextWindow(
        { config: {}, provider_id: providerId, model: "deepseek-v4-flash" },
        "deepseek-v4-flash"
      );
      expect(resolved.contextWindowTokens).toBeUndefined();
      expect(resolved.contextWindow).toBeGreaterThan(0);
      expect(resolved.contextWindow).not.toBe(999999);
    } finally {
      tables.providerModels.deleteByProvider(providerId);
      tables.providers.delete(providerId);
    }
  });

  test("uses the agent max context when set", () => {
    const resolved = resolveTurnContextWindow(
      { config: { max_context_tokens: 32000 } },
      "gpt-5.6-sol"
    );
    expect(resolved.contextWindow).toBe(32000);
    expect(resolved.contextWindowTokens).toBe(32000);
  });

  test("falls back to the model window when unset", () => {
    const resolved = resolveTurnContextWindow({ config: {} }, "deepseek-v4-flash");
    expect(resolved.contextWindowTokens).toBeUndefined();
    expect(resolved.contextWindow).toBeGreaterThan(0);
    expect(resolved.contextWindow).not.toBe(32000);
  });

  test("handles a missing agent", () => {
    const resolved = resolveTurnContextWindow(undefined, "deepseek-v4-flash");
    expect(resolved.contextWindowTokens).toBeUndefined();
    expect(resolved.contextWindow).toBeGreaterThan(0);
  });
});

describe("request-visible context estimation", () => {
  test("caps historical tool results at the prompt truncation limit", () => {
    const messages = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "t1",
            name: "read",
            args: { path: "/tmp/x.ts" },
            status: "completed",
            result: "x".repeat(40_000),
          },
        ],
      },
    ] as ChatMessage[];
    const estimate = estimateMessagesRequestVisibleTokens(messages);
    expect(estimate).toBeGreaterThan(50);
    expect(estimate).toBeLessThan(2000);
  });

  test("excludes tool calls without replayable results", () => {
    const messages = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "t1", name: "read", args: { path: "/tmp/x.ts" }, status: "pending" }],
      },
    ] as ChatMessage[];
    expect(estimateMessagesRequestVisibleTokens(messages)).toBeLessThan(100);
  });

  test("compaction decision accounts for replayed tool results", () => {
    const toolCalls = Array.from({ length: 1500 }, (_, index) => ({
      id: `t-${index}`,
      name: "exec",
      args: { command: "echo hi" },
      status: "completed",
      result: "y".repeat(4000),
    }));
    const messages = [{ role: "assistant", content: "", tool_calls: toolCalls }] as ChatMessage[];
    const check = shouldCompactContext(messages, "deepseek-v4-flash", undefined, 786432);
    expect(check.needed).toBe(true);
  });
});

describe("session context compaction with agent window override", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "a".repeat(4000) },
    { role: "assistant", content: "b".repeat(4000) },
  ];

  test("uses the override window instead of the model window", () => {
    const defaultCheck = shouldCompactContext(messages, "deepseek-v4-flash");
    const cappedCheck = shouldCompactContext(messages, "deepseek-v4-flash", undefined, 8000);
    expect(defaultCheck.maxTokens).not.toBe(8000);
    expect(cappedCheck.maxTokens).toBe(8000);
  });

  test("triggers compaction sooner with a smaller override window", () => {
    const smallWindow = shouldCompactContext(messages, "deepseek-v4-flash", undefined, 2048);
    const largeWindow = shouldCompactContext(messages, "deepseek-v4-flash", undefined, 131072);
    expect(smallWindow.needed).toBe(true);
    expect(largeWindow.needed).toBe(false);
  });

  test("falls back to the model window when no override is given", () => {
    const withOverride = shouldCompactContext(messages, "deepseek-v4-flash", undefined, 16000);
    const withoutOverride = shouldCompactContext(messages, "deepseek-v4-flash");
    expect(withOverride.maxTokens).toBe(16000);
    expect(withoutOverride.maxTokens).toBe(
      shouldCompactContext(messages, "deepseek-v4-flash").maxTokens
    );
  });
});
