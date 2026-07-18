import { describe, expect, test } from "bun:test";
import { formatLlmFailure } from "../../src/core/agent-error-format";
import {
  resolveModelContextWindowTokens,
  resolveModelMaxOutputTokens,
  shouldPreferMaxCompletionTokens,
} from "../../src/core/agent-model-limits";
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
} from "../../src/core/agent-internals";

describe("agent helper modules", () => {
  test("formats common provider failures into user-facing messages", () => {
    expect(formatLlmFailure(new Error("invalid_api_key"))).toContain("OpenAI API key");
    expect(
      formatLlmFailure(new Error('API error: 400 - {"error":{"message":"too many tokens"}}'))
    ).toBe("Provider rejected the request (400): too many tokens");
    expect(formatLlmFailure(new Error("429 rate limit"))).toContain("rate limit");
    expect(
      formatLlmFailure(
        new Error(
          "API error: 429 - You've reached your usage limit for this period. Your quota will be refreshed in the next period."
        )
      )
    ).toContain("rolling usage window");
    expect(
      formatLlmFailure(
        new Error("API error: 429 - We're receiving too many requests at the moment.")
      )
    ).toContain("automatic retries");
  });

  test("keeps provider-specific token parameter preference outside AgentManager", () => {
    expect(shouldPreferMaxCompletionTokens("z.ai")).toBe(true);
    expect(shouldPreferMaxCompletionTokens("zai")).toBe(true);
    expect(shouldPreferMaxCompletionTokens("openai")).toBe(false);
  });

  test("falls back to default model limits when no provider metadata matches", () => {
    expect(resolveModelMaxOutputTokens("unknown-provider", undefined, "missing-model")).toBe(
      DEFAULT_MODEL_MAX_OUTPUT_TOKENS
    );
    expect(resolveModelContextWindowTokens("unknown-provider", undefined, "missing-model")).toBe(
      DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    );
  });

  test("keeps GPT-5.6 API and Codex context limits provider-specific", () => {
    expect(resolveModelContextWindowTokens("openai", undefined, "gpt-5.6-sol")).toBe(1050000);
    expect(resolveModelContextWindowTokens("openai-codex", undefined, "gpt-5.6-sol")).toBe(372000);
    expect(resolveModelMaxOutputTokens("openai", undefined, "gpt-5.6-luna")).toBe(128000);
    expect(resolveModelMaxOutputTokens("openai-codex", undefined, "gpt-5.6-luna")).toBe(128000);
  });

  test("resolves Kimi coding-plan context limits from the model catalog", () => {
    expect(resolveModelContextWindowTokens("kimi-code-oauth", undefined, "k3")).toBe(1_048_576);
    expect(resolveModelMaxOutputTokens("kimi-code-oauth", undefined, "k3")).toBe(32_768);
    expect(resolveModelContextWindowTokens("kimi-code-oauth", undefined, "kimi-for-coding")).toBe(
      262_144
    );
  });
});
