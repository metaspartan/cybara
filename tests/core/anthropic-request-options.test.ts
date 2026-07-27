import { describe, expect, test } from "bun:test";
import {
  applyAnthropicReasoningOptions,
  collectAnthropicThinkingText,
  resolveAnthropicToolChoice,
  shouldSendAnthropicContext1mBeta,
} from "../../src/core/llm/anthropic-request-options";

describe("Anthropic request options", () => {
  test("keeps MiniMax M3 adaptive across every request regardless of global effort", () => {
    const requestBody: Record<string, unknown> = { temperature: 1 };

    applyAnthropicReasoningOptions(requestBody, "minimax-portal", "MiniMax-M3", 131072, {
      reasoning_effort: "high",
    });

    expect(requestBody.thinking).toEqual({ type: "adaptive" });
    expect(requestBody.output_config).toBeUndefined();
    expect(requestBody.temperature).toBeUndefined();
  });

  test("keeps existing Anthropic effort behavior for non-MiniMax models", () => {
    const requestBody: Record<string, unknown> = {};

    applyAnthropicReasoningOptions(requestBody, "anthropic", "claude-opus-4-6", 64000, {
      reasoning_effort: "high",
    });

    expect(requestBody.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(requestBody.output_config).toEqual({ effort: "high" });
  });

  test("uses adaptive Claude 5 effort without incompatible sampling options", () => {
    const requestBody: Record<string, unknown> = {
      temperature: 0.5,
      top_p: 0.9,
      top_k: 20,
    };

    applyAnthropicReasoningOptions(requestBody, "anthropic", "claude-opus-5", 128000, {
      reasoning_effort: "max",
    });

    expect(requestBody.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(requestBody.output_config).toEqual({ effort: "max" });
    expect(requestBody.temperature).toBeUndefined();
    expect(requestBody.top_p).toBeUndefined();
    expect(requestBody.top_k).toBeUndefined();
  });

  test("preserves a valid top-p value for legacy manual thinking", () => {
    const requestBody: Record<string, unknown> = {
      temperature: 0.5,
      top_p: 0.97,
      top_k: 20,
    };

    applyAnthropicReasoningOptions(requestBody, "anthropic", "claude-sonnet-4-5", 64000, {
      reasoning_effort: "high",
    });

    expect(requestBody.thinking).toEqual({ type: "enabled", budget_tokens: 16384 });
    expect(requestBody.temperature).toBeUndefined();
    expect(requestBody.top_p).toBe(0.97);
    expect(requestBody.top_k).toBeUndefined();
  });

  test("removes an invalid top-p value from legacy manual thinking", () => {
    const requestBody: Record<string, unknown> = { top_p: 0.9 };

    applyAnthropicReasoningOptions(requestBody, "anthropic", "claude-sonnet-4-5", 64000, {
      reasoning_effort: "high",
    });

    expect(requestBody.top_p).toBeUndefined();
  });

  test("sends the legacy 1M beta only for models without native 1M context", () => {
    expect(shouldSendAnthropicContext1mBeta("claude-opus-5", true)).toBe(false);
    expect(shouldSendAnthropicContext1mBeta("claude-sonnet-5", true)).toBe(false);
    expect(shouldSendAnthropicContext1mBeta("claude-opus-4-8", true)).toBe(false);
    expect(shouldSendAnthropicContext1mBeta("claude-sonnet-4-5", true)).toBe(true);
    expect(shouldSendAnthropicContext1mBeta("claude-sonnet-4-5", false)).toBe(false);
  });

  test("maps directed tool requirements to the Anthropic tool choice contract", () => {
    expect(resolveAnthropicToolChoice(["read", "exec"])).toEqual({ type: "auto" });
    expect(resolveAnthropicToolChoice(["read", "exec"], { requireToolUse: true })).toEqual({
      type: "any",
    });
    expect(
      resolveAnthropicToolChoice(["read", "exec"], {
        requireToolUse: true,
        requiredToolName: "read",
      })
    ).toEqual({ type: "tool", name: "read" });
  });

  test("collects native MiniMax thinking blocks without exposing signatures", () => {
    expect(
      collectAnthropicThinkingText([
        { type: "thinking", thinking: "Inspect the project first." },
        { type: "tool_use" },
        { type: "thinking", thinking: "Verify the result." },
      ])
    ).toEqual(["Inspect the project first.", "Verify the result."]);
  });
});
