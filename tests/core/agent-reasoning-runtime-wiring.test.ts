import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const providerRuntimeSource = readFileSync(
  fileURLToPath(new URL("../../src/core/agent-provider-runtime.ts", import.meta.url)),
  "utf8"
);

describe("agent reasoning runtime wiring", () => {
  test("applies selected effort to Codex Responses", () => {
    expect(providerRuntimeSource).toContain("const codexEffort = normalizeReasoningEffort(");
    expect(providerRuntimeSource).toContain("requestBody.reasoning = {");
    expect(providerRuntimeSource).toContain(
      "coerceReasoningEffort(codexEffort, providerConfig, activeModelId)"
    );
  });

  test("uses adaptive thinking for modern Anthropic models", () => {
    expect(providerRuntimeSource).toContain("usesAnthropicAdaptiveThinking(modelId)");
    expect(providerRuntimeSource).toContain(
      'requestBody.thinking = { type: "adaptive", display: "summarized" }'
    );
    expect(providerRuntimeSource).toContain(
      "requestBody.output_config = { effort: resolvedEffort }"
    );
  });

  test("uses model-aware Gemini thinking configuration", () => {
    expect(providerRuntimeSource).toContain(
      "googleThinkingConfig(googleEffort, normalizedModelId)"
    );
  });
});
