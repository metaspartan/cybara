import { describe, expect, test } from "bun:test";
import { supportedReasoningEfforts } from "../../shared/reasoning-capabilities";
import {
  resolveAnthropicToolChoice,
  supportsAnthropicForcedToolChoice,
} from "../../src/core/llm/anthropic-request-options";
import { shouldRetryByRemovingToolChoice } from "../../src/core/llm/tool-choice-compat";
import { getOpenAICodexModelCandidates } from "../../src/core/openai-codex-models";
import { providers } from "../../src/core/providers";
import { getPricing } from "../../src/core/router";

describe("latest Claude and OpenAI models", () => {
  test("lists Claude Opus 5.5 first in the Anthropic catalog with Fable 5.1 kept", () => {
    const models = providers.anthropic.models;
    expect(models[0]).toMatchObject({
      id: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      context: 1000000,
      maxTokens: 128000,
      reasoning: true,
    });
    expect(models.map((model) => model.id)).toContain("claude-fable-5-1");
  });

  test("lists GPT-6 Sol, Luna, and Astra in the API and Codex catalogs", () => {
    for (const modelId of ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra"]) {
      expect(providers.openai.models.find((model) => model.id === modelId)).toMatchObject({
        context: 1050000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      });
      expect(providers["openai-codex"].models.find((model) => model.id === modelId)?.context).toBe(
        372000
      );
    }
    expect(getOpenAICodexModelCandidates("gpt-6-sol")).toEqual([
      "gpt-6-sol",
      "gpt-5.6-sol",
      "gpt-5.5",
      "gpt-5.4",
    ]);
    expect(getOpenAICodexModelCandidates("gpt-6-luna")[1]).toBe("gpt-5.6-luna");
  });

  test("offers the full effort range on GPT-6 and Claude Opus 5.5", () => {
    for (const modelId of ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra"]) {
      expect(supportedReasoningEfforts("openai", modelId)).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
    }
    expect(supportedReasoningEfforts("anthropic", "claude-opus-5-5")).toContain("xhigh");
    expect(supportedReasoningEfforts("anthropic", "claude-opus-5-5")).toContain("max");
  });

  test("prices the new models from the published rates", () => {
    expect(getPricing("anthropic", "claude-opus-5-5")).toEqual({
      inputPerM: 4,
      outputPerM: 20,
      cacheReadPerM: 0.2,
      cacheWritePerM: 5,
    });
    expect(getPricing("anthropic", "claude-fable-5-1")?.cacheReadPerM).toBe(0.25);
    expect(getPricing("openai", "gpt-6-sol")).toMatchObject({ inputPerM: 2, outputPerM: 10 });
    expect(getPricing("openai", "gpt-6-luna")).toMatchObject({ inputPerM: 0.1, outputPerM: 0.5 });
    expect(getPricing("openai", "gpt-6-astra")).toMatchObject({ inputPerM: 10, outputPerM: 50 });
    expect(getPricing("anthropic", "claude-unknown-model")?.inputPerM).toBe(5);
    expect(getPricing("openai", "gpt-unknown")?.inputPerM).toBe(5);
  });

  test("never forces a tool on models that reject forced tool choice", () => {
    const required = { requireToolUse: true, requiredToolName: "read" };
    for (const modelId of [
      "claude-opus-5-5",
      "claude-fable-5-1",
      "claude-mythos-5-1",
      "anthropic.claude-opus-5-5",
    ]) {
      expect(supportsAnthropicForcedToolChoice(modelId)).toBe(false);
      expect(resolveAnthropicToolChoice(["read", "exec"], required, modelId)).toEqual({
        type: "auto",
      });
    }
    for (const modelId of [
      "claude-opus-5",
      "claude-fable-5",
      "claude-sonnet-5",
      "claude-opus-4-8",
    ]) {
      expect(supportsAnthropicForcedToolChoice(modelId)).toBe(true);
    }
    expect(resolveAnthropicToolChoice(["read", "exec"], required, "claude-opus-5")).toEqual({
      type: "tool",
      name: "read",
    });
  });

  test("retries without tool_choice when a model rejects forced tool use", () => {
    const body = { tool_choice: { type: "any" } };
    expect(
      shouldRetryByRemovingToolChoice(
        400,
        'tool_choice: type "tool" and "any" are not supported for this model.',
        body
      )
    ).toBe(true);
    expect(shouldRetryByRemovingToolChoice(400, "max_tokens is too large", body)).toBe(false);
    expect(
      shouldRetryByRemovingToolChoice(
        400,
        'tool_choice: type "tool" and "any" are not supported for this model.',
        {}
      )
    ).toBe(false);
  });
});
