import { describe, expect, test } from "bun:test";
import { readProviderRuntimeSource } from "../source-fixtures";

const providerRuntimeSource = readProviderRuntimeSource();

describe("agent reasoning runtime wiring", () => {
  test("applies selected effort to Codex Responses", () => {
    expect(providerRuntimeSource).toContain("const codexEffort = normalizeReasoningEffort(");
    expect(providerRuntimeSource).toContain("requestBody.reasoning = {");
    expect(providerRuntimeSource).toContain(
      "coerceReasoningEffort(codexEffort, providerConfig, activeModelId)"
    );
  });

  test("applies Anthropic reasoning options on every request path", () => {
    expect(providerRuntimeSource.match(/applyAnthropicReasoningOptions\(/g)).toHaveLength(4);
  });

  test("uses model-aware Gemini thinking configuration", () => {
    expect(providerRuntimeSource).toContain(
      "googleThinkingConfig(googleEffort, normalizedModelId)"
    );
  });
});
