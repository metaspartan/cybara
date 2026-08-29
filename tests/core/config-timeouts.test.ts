import { describe, expect, test } from "bun:test";
import { DEFAULT_LLM_TIMEOUT_SETTINGS, normalizeLlmTimeoutSettings } from "../../src/core/config";

describe("LLM timeout defaults", () => {
  test("allows long cloud reasoning within ordinary task budgets", () => {
    expect(DEFAULT_LLM_TIMEOUT_SETTINGS.firstTokenSeconds).toBe(300);
    expect(normalizeLlmTimeoutSettings(undefined).firstTokenSeconds).toBe(300);
    expect(DEFAULT_LLM_TIMEOUT_SETTINGS.stallSeconds).toBe(300);
  });

  test("preserves explicit longer first-token settings", () => {
    expect(normalizeLlmTimeoutSettings({ firstTokenSeconds: 420 }).firstTokenSeconds).toBe(420);
  });
});
