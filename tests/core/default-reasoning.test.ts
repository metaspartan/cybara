import { describe, expect, test } from "bun:test";
import {
  BUILT_IN_REASONING_EFFORT,
  builtInReasoningEffort,
  isKnownReasoningModel,
} from "../../src/core/llm/default-reasoning";

describe("built-in reasoning effort", () => {
  test("defaults GLM, which otherwise thinks at full depth, to medium when nothing is configured", () => {
    expect(BUILT_IN_REASONING_EFFORT).toBe("medium");
    for (const [provider, model] of [
      ["custom", "glm-5.3-flash"],
      ["z.ai-coding", "glm-5.3-flash"],
      ["openrouter", "z-ai/glm-5.3"],
      ["z.ai", "glm-4.7"],
    ]) {
      expect(builtInReasoningEffort(provider, model)).toBe("medium");
    }
  });

  test("leaves unknown or non-reasoning models and self-managed providers alone", () => {
    expect(builtInReasoningEffort("custom", "llama-3.3-70b")).toBeUndefined();
    expect(builtInReasoningEffort("openai", "gpt-4o")).toBeUndefined();
    expect(builtInReasoningEffort("openai", "gpt-6-sol")).toBeUndefined();
    expect(builtInReasoningEffort("deepseek", "deepseek-v4-flash")).toBeUndefined();
    expect(builtInReasoningEffort("minimax", "MiniMax-M3")).toBeUndefined();
    expect(builtInReasoningEffort("qwen-portal", "qwen3.7-plus")).toBeUndefined();
  });

  test("a catalog entry marked non-reasoning is never given an effort", () => {
    expect(isKnownReasoningModel("glm-5.3-flash", false)).toBe(false);
    expect(isKnownReasoningModel("house-model", true)).toBe(false);
  });
});
