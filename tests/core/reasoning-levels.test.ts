import { describe, expect, test } from "bun:test";
import {
  coerceReasoningEffort,
  normalizeReasoningEffort,
  supportedReasoningEfforts,
  supportsXHighReasoning,
} from "../../src/core/llm/reasoning";

describe("reasoning level support matrix", () => {
  test("openai gpt-5.1 has no xhigh, gpt-5.2+ does", () => {
    expect(supportsXHighReasoning("openai", "gpt-5.1")).toBe(false);
    expect(supportsXHighReasoning("openai", "gpt-5.2")).toBe(true);
    expect(supportsXHighReasoning("openai", "gpt-5.4")).toBe(true);
    expect(supportsXHighReasoning("openai", "gpt-5.6-sol")).toBe(true);
  });

  test("codex models always support xhigh", () => {
    expect(supportsXHighReasoning("openai-codex", "gpt-5.3-codex")).toBe(true);
    expect(supportsXHighReasoning("openai-codex", "gpt-5.1-codex")).toBe(true);
  });

  test("anthropic supports xhigh via thinking budgets", () => {
    expect(supportedReasoningEfforts("anthropic", "claude-opus-4-8")).toContain("xhigh");
  });

  test("google caps at high", () => {
    expect(supportedReasoningEfforts("google", "gemini-3-pro-preview")).not.toContain("xhigh");
  });

  test("z.ai is binary thinking", () => {
    expect(supportedReasoningEfforts("z.ai", "glm-5.2")).toEqual(["medium"]);
    expect(supportedReasoningEfforts("z.ai-coding", "glm-5.2")).toEqual(["medium"]);
  });

  test("unknown provider gets the base ladder", () => {
    expect(supportedReasoningEfforts("groq", "llama-3.3-70b-versatile")).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("coerceReasoningEffort downgrades gracefully", () => {
  test("xhigh downgrades to high when unsupported", () => {
    expect(coerceReasoningEffort("xhigh", "google", "gemini-2.5-pro")).toBe("high");
    expect(coerceReasoningEffort("xhigh", "openai", "gpt-5.1")).toBe("high");
  });

  test("xhigh passes through when supported", () => {
    expect(coerceReasoningEffort("xhigh", "openai", "gpt-5.4")).toBe("xhigh");
    expect(coerceReasoningEffort("xhigh", "anthropic", "claude-opus-4-8")).toBe("xhigh");
  });

  test("binary providers collapse every level to medium", () => {
    expect(coerceReasoningEffort("xhigh", "z.ai", "glm-5.2")).toBe("medium");
    expect(coerceReasoningEffort("minimal", "z.ai", "glm-5.2")).toBe("medium");
    expect(coerceReasoningEffort("high", "z.ai", "glm-5.2")).toBe("medium");
  });

  test("supported levels are untouched", () => {
    expect(coerceReasoningEffort("medium", "openai", "gpt-5.1")).toBe("medium");
    expect(coerceReasoningEffort("minimal", "google", "gemini-2.5-flash")).toBe("minimal");
  });
});

describe("normalizeReasoningEffort aliases", () => {
  test("extra high and ultra map to xhigh", () => {
    expect(normalizeReasoningEffort("extra high")).toBe("xhigh");
    expect(normalizeReasoningEffort("Extra-High")).toBe("xhigh");
    expect(normalizeReasoningEffort("ultra")).toBe("xhigh");
    expect(normalizeReasoningEffort("ultrathink")).toBe("xhigh");
    expect(normalizeReasoningEffort("max")).toBe("xhigh");
  });

  test("min maps to minimal and off maps to null", () => {
    expect(normalizeReasoningEffort("min")).toBe("minimal");
    expect(normalizeReasoningEffort("off")).toBeNull();
    expect(normalizeReasoningEffort("none")).toBeNull();
  });
});
