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
import { canPreStartOpenAIToolCall } from "../../src/core/agent-provider-openai-compat-runtime";
import { openAICompatClosingReasoningParams } from "../../src/core/llm/reasoning";

describe("agent helper modules", () => {
  test("prestarts independent reads but validates mutations before execution", () => {
    expect(canPreStartOpenAIToolCall("read")).toBe(true);
    expect(canPreStartOpenAIToolCall("exec")).toBe(true);
    expect(canPreStartOpenAIToolCall("write")).toBe(false);
    expect(canPreStartOpenAIToolCall("edit")).toBe(false);
    expect(canPreStartOpenAIToolCall("apply_patch")).toBe(false);
  });

  test("formats common provider failures into user-facing messages", () => {
    expect(formatLlmFailure(new Error("invalid_api_key"))).toContain("OpenAI API key");
    expect(
      formatLlmFailure(new Error('API error: 400 - {"error":{"message":"too many tokens"}}'))
    ).toBe("Provider rejected the request (400): too many tokens");
    expect(formatLlmFailure(new Error("429 rate limit"))).toContain("rate limit");
    expect(
      formatLlmFailure(
        new Error(
          'API error: 403 - {"error":{"message":"Your Go plan doesn\'t include API access. Upgrade to Provider or higher.","code":"upgrade_required"}}'
        )
      )
    ).toBe(
      "Provider rejected access (403): Your Go plan doesn't include API access. Upgrade to Provider or higher."
    );
    expect(formatLlmFailure(new Error("API error: 403 - forbidden"))).toBe(
      "Provider rejected access (403). Verify account permissions and model access."
    );
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

  test("directs expired OAuth sessions to reconnect without changing API-key guidance", () => {
    expect(
      formatLlmFailure(new Error("API error: 401 - unauthorized"), {
        authType: "oauth",
        providerName: "xAI Grok OAuth",
      })
    ).toBe("xAI Grok OAuth sign-in expired (401). Reconnect the provider in Settings and retry.");
    expect(
      formatLlmFailure(new Error("API error: 401 - unauthorized"), {
        authType: "api_key",
        providerName: "xAI",
      })
    ).toBe("Provider authentication failed (401). Verify your provider API key/token.");
  });

  test("keeps provider-specific token parameter preference outside AgentManager", () => {
    expect(shouldPreferMaxCompletionTokens("z.ai")).toBe(true);
    expect(shouldPreferMaxCompletionTokens("zai")).toBe(true);
    expect(shouldPreferMaxCompletionTokens("kimi-code-oauth")).toBe(true);
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

  test("uses known model limits for custom compatible endpoints", () => {
    expect(resolveModelContextWindowTokens("custom", undefined, "MiniMax-M3")).toBe(1_000_000);
    expect(resolveModelMaxOutputTokens("custom", undefined, "MiniMax-M3")).toBe(32_768);
  });

  test("disables MiniMax M3 thinking for a forced closing response", () => {
    expect(openAICompatClosingReasoningParams("MiniMax-M3")).toEqual({
      reasoning_split: true,
      thinking: { type: "disabled" },
    });
    expect(openAICompatClosingReasoningParams("MiniMax-M2.7")).toEqual({});
    expect(openAICompatClosingReasoningParams("GLM-5.3")).toEqual({
      reasoning_effort: "low",
    });
  });
});
