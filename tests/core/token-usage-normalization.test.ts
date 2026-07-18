import { describe, expect, test } from "bun:test";
import {
  normalizeProviderTokenUsage,
  resolveGoogleOutputTokens,
} from "../../src/core/llm/token-usage-normalization";

describe("provider token usage normalization", () => {
  test("keeps included cache reads within effective input", () => {
    expect(
      normalizeProviderTokenUsage({
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 60,
        cacheTokenAccounting: "included",
      })
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 60,
      cacheWriteTokens: 0,
      totalTokens: 120,
    });
  });

  test("adds separately reported cache reads and writes to effective input", () => {
    expect(
      normalizeProviderTokenUsage({
        inputTokens: 20,
        outputTokens: 30,
        cachedInputTokens: 60,
        cacheWriteTokens: 20,
        cacheTokenAccounting: "separate",
      })
    ).toEqual({
      inputTokens: 100,
      outputTokens: 30,
      cachedInputTokens: 60,
      cacheWriteTokens: 20,
      totalTokens: 130,
    });
  });

  test("includes Gemini thinking tokens in generated output", () => {
    expect(
      resolveGoogleOutputTokens({
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 30,
        totalTokenCount: 150,
      })
    ).toBe(50);
    expect(resolveGoogleOutputTokens({ candidatesTokenCount: 20, thoughtsTokenCount: 30 })).toBe(
      50
    );
  });
});
