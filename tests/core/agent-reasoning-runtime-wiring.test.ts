import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const agentSource = readFileSync(
  fileURLToPath(new URL("../../src/core/agent.ts", import.meta.url)),
  "utf8"
);

describe("agent reasoning runtime wiring", () => {
  test("applies selected effort to Codex Responses", () => {
    expect(agentSource).toContain("const codexEffort = normalizeReasoningEffort(");
    expect(agentSource).toContain("requestBody.reasoning = {");
    expect(agentSource).toContain(
      "coerceReasoningEffort(codexEffort, providerConfig, activeModelId)"
    );
  });

  test("uses adaptive thinking for modern Anthropic models", () => {
    expect(agentSource).toContain("usesAnthropicAdaptiveThinking(modelId)");
    expect(agentSource).toContain(
      'requestBody.thinking = { type: "adaptive", display: "summarized" }'
    );
    expect(agentSource).toContain("requestBody.output_config = { effort: resolvedEffort }");
  });

  test("uses model-aware Gemini thinking configuration", () => {
    expect(agentSource).toContain("googleThinkingConfig(googleEffort, normalizedModelId)");
  });
});
