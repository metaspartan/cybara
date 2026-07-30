import { describe, expect, test } from "bun:test";
import {
  estimateAnthropicRequestInputTokens,
  isAnthropicContextOverflowError,
  recoverAnthropicRequestForContext,
  resolveAnthropicRequestTokenLimit,
} from "../../src/core/llm/anthropic-context";

describe("Anthropic request context recovery", () => {
  test("reserves context for fixed request input", () => {
    const request = {
      model: "model",
      system: "s".repeat(20_000),
      messages: [{ role: "user", content: [{ type: "text", text: "u".repeat(20_000) }] }],
      max_tokens: 16_000,
    };
    expect(resolveAnthropicRequestTokenLimit(request, 16_000, 12_000)).toBeLessThan(2_000);
  });

  test("estimates images by visual tokens rather than base64 length", () => {
    const request = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "a".repeat(2_000_000) },
            },
          ],
        },
      ],
    };
    expect(estimateAnthropicRequestInputTokens(request)).toBeLessThan(5_000);
  });

  test("recognizes MiniMax 2013 and compacts an initial request", () => {
    const request: Record<string, unknown> = {
      system: "system",
      max_tokens: 64_000,
      messages: Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: [{ type: "text", text: `message-${index}` }],
      })),
    };
    expect(isAnthropicContextOverflowError("minimax", "invalid params, 400 (2013)", false)).toBe(
      true
    );
    expect(recoverAnthropicRequestForContext(request, 204_800, 0)).toBe(true);
    expect((request.messages as unknown[]).length).toBeLessThan(10);
    expect(request.max_tokens).toBe(32_000);
  });

  test("does not classify unrelated provider errors as context overflow", () => {
    expect(isAnthropicContextOverflowError("anthropic", "invalid params, 400 (2013)", false)).toBe(
      false
    );
  });
});
