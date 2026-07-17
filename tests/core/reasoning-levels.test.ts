import { describe, expect, test } from "bun:test";
import {
  coerceReasoningEffort,
  normalizeReasoningEffort,
  supportedReasoningEfforts,
  supportsXHighReasoning,
} from "../../src/core/llm/reasoning";

describe("reasoning level support matrix", () => {
  test("openai gpt-5.0 has no xhigh", () => {
    expect(supportedReasoningEfforts("openai", "gpt-5")).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(supportsXHighReasoning("openai", "gpt-5")).toBe(false);
  });

  test("openai gpt-5.1 drops minimal and xhigh", () => {
    expect(supportedReasoningEfforts("openai", "gpt-5.1")).toEqual(["low", "medium", "high"]);
    expect(supportsXHighReasoning("openai", "gpt-5.1")).toBe(false);
  });

  test("openai gpt-5.2 through 5.5 supports xhigh and drops minimal", () => {
    expect(supportedReasoningEfforts("openai", "gpt-5.2")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(supportsXHighReasoning("openai", "gpt-5.4")).toBe(true);
    expect(supportsXHighReasoning("openai", "gpt-5.6-sol")).toBe(true);
  });

  test("openai gpt-5.6 keeps xhigh and adds a distinct max tier", () => {
    expect(supportedReasoningEfforts("openai", "gpt-5.6-sol")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  test("codex models expose low..xhigh and reject minimal", () => {
    expect(supportedReasoningEfforts("openai-codex", "gpt-5.3-codex")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(supportedReasoningEfforts("openai", "gpt-5.1-codex")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(supportsXHighReasoning("openai-codex", "gpt-5.3-codex")).toBe(true);
  });

  test("codex-mini supports only medium", () => {
    expect(supportedReasoningEfforts("openai", "gpt-5.1-codex-mini")).toEqual(["medium"]);
  });

  test("codex-max supports medium/high/xhigh", () => {
    expect(supportedReasoningEfforts("openai", "gpt-5.1-codex-max")).toEqual([
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("gpt-5-pro supports only high; gpt-5.2-pro supports medium/high/xhigh", () => {
    expect(supportedReasoningEfforts("openai", "gpt-5-pro")).toEqual(["high"]);
    expect(supportedReasoningEfforts("openai", "gpt-5.2-pro")).toEqual(["medium", "high", "xhigh"]);
  });

  test("anthropic uses model-specific adaptive effort ladders", () => {
    expect(supportedReasoningEfforts("anthropic", "claude-opus-4-8")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(supportedReasoningEfforts("anthropic_vertex", "claude-sonnet-4-6")).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
  });

  test("google caps at high", () => {
    expect(supportedReasoningEfforts("google", "gemini-3-pro-preview")).not.toContain("xhigh");
    expect(supportedReasoningEfforts("google", "gemini-2.5-pro")).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(supportedReasoningEfforts("google", "gemini-3.1-pro-preview")).toEqual(["low", "high"]);
  });

  test("z.ai is binary thinking", () => {
    expect(supportedReasoningEfforts("z.ai", "glm-5.2")).toEqual(["medium"]);
    expect(supportedReasoningEfforts("z.ai-coding", "glm-5.2")).toEqual(["medium"]);
  });

  test("MiniMax M3 keeps provider-adaptive reasoning", () => {
    expect(supportedReasoningEfforts("minimax", "MiniMax-M3")).toEqual([]);
    expect(supportedReasoningEfforts("minimax-portal", "minimax-m3")).toEqual([]);
  });

  test("Kimi K3 uses the current max-only reasoning contract", () => {
    expect(supportedReasoningEfforts("kimi-code", "k3")).toEqual(["max"]);
    expect(supportedReasoningEfforts("kimi-code-oauth", "k3")).toEqual(["max"]);
    expect(supportedReasoningEfforts("kimi-code-subscription", "k3")).toEqual(["max"]);
    expect(coerceReasoningEffort("high", "kimi-code-oauth", "k3")).toBe("max");
  });

  test("unknown openai model gets low/medium/high", () => {
    expect(supportedReasoningEfforts("openai", "o3-pro")).toEqual(["low", "medium", "high"]);
  });

  test("unknown provider gets low/medium/high", () => {
    expect(supportedReasoningEfforts("groq", "llama-3.3-70b-versatile")).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });

  test("strips provider prefix and date suffix from model id", () => {
    expect(supportedReasoningEfforts("openai", "openai/gpt-5.2-2026-07-01")).toContain("xhigh");
    expect(supportedReasoningEfforts("openai", "gpt-5-codex-2026-07-01")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
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

  test("minimal downgrades on codex (rejects minimal) to low", () => {
    expect(coerceReasoningEffort("minimal", "openai", "gpt-5.3-codex")).toBe("low");
  });

  test("minimal downgrades to medium on codex-mini", () => {
    expect(coerceReasoningEffort("minimal", "openai", "gpt-5.1-codex-mini")).toBe("medium");
    expect(coerceReasoningEffort("low", "openai", "gpt-5.1-codex-mini")).toBe("medium");
  });

  test("xhigh downgrades to high on gpt-5-pro", () => {
    expect(coerceReasoningEffort("xhigh", "openai", "gpt-5-pro")).toBe("high");
    expect(coerceReasoningEffort("low", "openai", "gpt-5-pro")).toBe("high");
  });

  test("binary providers collapse every level to medium", () => {
    expect(coerceReasoningEffort("xhigh", "z.ai", "glm-5.2")).toBe("medium");
    expect(coerceReasoningEffort("minimal", "z.ai", "glm-5.2")).toBe("medium");
    expect(coerceReasoningEffort("high", "z.ai", "glm-5.2")).toBe("medium");
  });

  test("supported levels are untouched", () => {
    expect(coerceReasoningEffort("medium", "openai", "gpt-5.1")).toBe("medium");
    expect(coerceReasoningEffort("minimal", "google", "gemini-2.5-flash")).toBe("low");
  });
});

describe("normalizeReasoningEffort aliases", () => {
  test("extra high maps to xhigh while max aliases remain a distinct maximum", () => {
    expect(normalizeReasoningEffort("extra high")).toBe("xhigh");
    expect(normalizeReasoningEffort("Extra-High")).toBe("xhigh");
    expect(normalizeReasoningEffort("ultra")).toBe("max");
    expect(normalizeReasoningEffort("ultrathink")).toBe("max");
    expect(normalizeReasoningEffort("ultracode")).toBe("max");
    expect(normalizeReasoningEffort("max")).toBe("max");
  });

  test("min maps to minimal and off maps to null", () => {
    expect(normalizeReasoningEffort("min")).toBe("minimal");
    expect(normalizeReasoningEffort("off")).toBeNull();
    expect(normalizeReasoningEffort("none")).toBeNull();
  });
});
