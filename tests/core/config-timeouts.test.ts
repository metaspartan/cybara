import { describe, expect, test } from "bun:test";
import { DEFAULT_LLM_TIMEOUT_SETTINGS, normalizeLlmTimeoutSettings } from "../../src/core/config";

describe("LLM timeout defaults", () => {
  test("retries a silent cloud request before ordinary task budgets are exhausted", () => {
    expect(DEFAULT_LLM_TIMEOUT_SETTINGS.firstTokenSeconds).toBe(20);
    expect(normalizeLlmTimeoutSettings(undefined).firstTokenSeconds).toBe(20);
    expect(DEFAULT_LLM_TIMEOUT_SETTINGS.stallSeconds).toBe(60);
  });

  test("preserves explicit longer first-token settings", () => {
    expect(normalizeLlmTimeoutSettings({ firstTokenSeconds: 420 }).firstTokenSeconds).toBe(420);
  });
});
