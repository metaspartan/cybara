import { describe, expect, test } from "bun:test";
import {
  normalizeReasoningEffort,
  openAICompatReasoningParams,
  anthropicThinkingBudget,
  googleThinkingBudget,
  googleThinkingConfig,
  usesAnthropicAdaptiveThinking,
} from "../../src/core/llm/reasoning";

describe("normalizeReasoningEffort", () => {
  test("accepts valid levels (case-insensitive)", () => {
    expect(normalizeReasoningEffort("high")).toBe("high");
    expect(normalizeReasoningEffort("LOW")).toBe("low");
    expect(normalizeReasoningEffort(" medium ")).toBe("medium");
    expect(normalizeReasoningEffort("max")).toBe("max");
  });

  test("rejects off/none/garbage", () => {
    expect(normalizeReasoningEffort("none")).toBeNull();
    expect(normalizeReasoningEffort("off")).toBeNull();
    expect(normalizeReasoningEffort("")).toBeNull();
    expect(normalizeReasoningEffort(5)).toBeNull();
    expect(normalizeReasoningEffort(undefined)).toBeNull();
  });
});

describe("openAICompatReasoningParams (per-provider shapes)", () => {
  test("default OpenAI-style reasoning_effort", () => {
    expect(openAICompatReasoningParams("openai", "high")).toEqual({ reasoning_effort: "high" });
    expect(openAICompatReasoningParams("xai", "low")).toEqual({ reasoning_effort: "low" });
  });

  test("MiniMax M3 omits explicit reasoning effort", () => {
    expect(openAICompatReasoningParams("minimax", "high", "MiniMax-M3")).toEqual({});
    expect(openAICompatReasoningParams("minimax-portal", "medium", "MiniMax-M3")).toEqual({});
  });

  test("zai/qwen use enable_thinking", () => {
    expect(openAICompatReasoningParams("z.ai", "medium")).toEqual({ enable_thinking: true });
    expect(openAICompatReasoningParams("qwen-portal", "high")).toEqual({ enable_thinking: true });
  });

  test("deepseek uses thinking + reasoning_effort", () => {
    expect(openAICompatReasoningParams("deepseek", "high")).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
  });

  test("openrouter nests reasoning.effort", () => {
    expect(openAICompatReasoningParams("openrouter", "medium")).toEqual({
      reasoning: { effort: "medium" },
    });
  });

  test("together uses reasoning.enabled + reasoning_effort", () => {
    expect(openAICompatReasoningParams("together", "low")).toEqual({
      reasoning: { enabled: true },
      reasoning_effort: "low",
    });
  });
});

describe("thinking budgets", () => {
  test("anthropic budget scales with effort", () => {
    expect(anthropicThinkingBudget("low")).toBe(2048);
    expect(anthropicThinkingBudget("high")).toBe(16384);
  });

  test("anthropic budget capped below max output tokens", () => {
    expect(anthropicThinkingBudget("xhigh", 4096)).toBe(4095);
    expect(anthropicThinkingBudget("high", 64000)).toBe(16384);
  });

  test("google budget", () => {
    expect(googleThinkingBudget("medium")).toBe(8192);
  });

  test("google uses family-specific thinking levels", () => {
    expect(googleThinkingConfig("medium", "gemini-3-flash-preview")).toEqual({
      includeThoughts: true,
      thinkingLevel: "medium",
    });
    expect(googleThinkingConfig("medium", "gemini-3.1-pro-preview")).toEqual({
      includeThoughts: true,
      thinkingLevel: "low",
    });
    expect(googleThinkingConfig("high", "gemini-2.5-pro")).toEqual({ includeThoughts: true });
  });

  test("anthropic adaptive mode follows model family", () => {
    expect(usesAnthropicAdaptiveThinking("claude-sonnet-4-6")).toBe(true);
    expect(usesAnthropicAdaptiveThinking("claude-opus-4-8")).toBe(true);
    expect(usesAnthropicAdaptiveThinking("claude-sonnet-4-5")).toBe(false);
    expect(usesAnthropicAdaptiveThinking("MiniMax-M2.7")).toBe(false);
  });
});
