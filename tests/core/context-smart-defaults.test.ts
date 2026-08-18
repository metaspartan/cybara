import { describe, expect, test } from "bun:test";
import { resolveModelContextWindowTokens } from "../../src/core/agent-model-limits";
import { tables } from "../../src/core/database";
import {
  estimateMessagesRequestVisibleTokens,
  getContextWindow,
  type ChatMessage,
} from "../../src/core/session-context";

function seedProvider(providerId: string): void {
  tables.providers.create({
    id: providerId,
    provider: "deepseek",
    name: `Test Provider ${providerId.slice(0, 8)}`,
    base_url: "https://test.invalid/v1",
    is_default: false,
  });
}

function seedModel(providerId: string, model: string, context: number, maxTokens: number): void {
  tables.providerModels.upsert({
    id: `pm-${crypto.randomUUID()}`,
    provider_id: providerId,
    model_id: model,
    model_name: model,
    context_window: context,
    max_tokens: maxTokens,
    reasoning: false,
    input_types: ["text"],
    cost_input: 0,
    cost_output: 0,
    cost_cache_read: 0,
    cost_cache_write: 0,
  });
}

describe("smart context defaults", () => {
  test("resolveModelContextWindowTokens skips generic 128k/8k fallback rows", () => {
    const providerId = `generic-fallback-${crypto.randomUUID()}`;
    const model = "custom-model-fallback-1";
    try {
      seedProvider(providerId);
      seedModel(providerId, model, 128000, 8192);
      const resolved = resolveModelContextWindowTokens("unknown-provider", providerId, model);
      expect(resolved).toBe(131072);
    } finally {
      tables.providerModels.deleteByProvider(providerId);
      tables.providers.delete(providerId);
    }
  });

  test("resolveModelContextWindowTokens uses real provider-scoped windows", () => {
    const providerId = `real-window-${crypto.randomUUID()}`;
    const model = "custom-model-real-1";
    try {
      seedProvider(providerId);
      seedModel(providerId, model, 786432, 65536);
      const resolved = resolveModelContextWindowTokens("unknown-provider", providerId, model);
      expect(resolved).toBe(786432);
    } finally {
      tables.providerModels.deleteByProvider(providerId);
      tables.providers.delete(providerId);
    }
  });

  test("getContextWindow picks the largest non-fallback window across providers", () => {
    const providerA = `multi-a-${crypto.randomUUID()}`;
    const providerB = `multi-b-${crypto.randomUUID()}`;
    const model = "shared-model-window-1";
    try {
      seedProvider(providerA);
      seedProvider(providerB);
      seedModel(providerA, model, 131072, 8192);
      seedModel(providerA, model, 128000, 8192);
      seedModel(providerB, model, 1048576, 65536);
      expect(getContextWindow(model)).toBe(1048576);
    } finally {
      tables.providerModels.deleteByProvider(providerA);
      tables.providerModels.deleteByProvider(providerB);
      tables.providers.delete(providerA);
      tables.providers.delete(providerB);
    }
  });

  test("getContextWindow ignores only-generic-fallback rows", () => {
    const providerId = `only-generic-${crypto.randomUUID()}`;
    const model = "generic-only-model-1";
    try {
      seedProvider(providerId);
      seedModel(providerId, model, 128000, 8192);
      expect(getContextWindow(model)).toBe(200000);
    } finally {
      tables.providerModels.deleteByProvider(providerId);
      tables.providers.delete(providerId);
    }
  });
});

describe("request-visible estimation safety", () => {
  test("does not throw on circular tool results", () => {
    const circular: Record<string, unknown> = { name: "read" };
    circular.self = circular;
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
            result: circular,
          },
        ],
      },
    ] as ChatMessage[];
    expect(() => estimateMessagesRequestVisibleTokens(messages)).not.toThrow();
    const estimate = estimateMessagesRequestVisibleTokens(messages);
    expect(estimate).toBeGreaterThan(50);
    expect(estimate).toBeLessThan(1000);
  });

  test("caps very large string results at the prompt truncation limit", () => {
    const messages = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "t2",
            name: "exec",
            args: { command: "cat big.txt" },
            status: "completed",
            result: "y".repeat(2_000_000),
          },
        ],
      },
    ] as ChatMessage[];
    const estimate = estimateMessagesRequestVisibleTokens(messages);
    expect(estimate).toBeLessThan(2000);
  });
});
