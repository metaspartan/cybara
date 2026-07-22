import { describe, expect, test } from "bun:test";
import {
  applyAnthropicReasoningOptions,
  collectAnthropicThinkingText,
  resolveAnthropicToolChoice,
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
