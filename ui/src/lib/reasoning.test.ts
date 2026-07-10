import { describe, expect, test } from "bun:test";
import {
  supportedReasoningOptions,
  supportsXHighReasoning,
  reasoningEffortLabel,
} from "./reasoning";

describe("supportsXHighReasoning", () => {
  test("codex models support xhigh", () => {
    expect(supportsXHighReasoning("openai", "gpt-5.2-codex")).toBe(true);
    expect(supportsXHighReasoning("openai-codex", "gpt-5.3-codex")).toBe(true);
  });

  test("anthropic supports xhigh", () => {
    expect(supportsXHighReasoning("anthropic", "claude-opus-4")).toBe(true);
    expect(supportsXHighReasoning("anthropic_vertex", "claude-sonnet-4")).toBe(true);
  });

  test("gpt-5.2+ supports xhigh", () => {
    expect(supportsXHighReasoning("openai", "gpt-5.2")).toBe(true);
    expect(supportsXHighReasoning("openai", "gpt-5.4")).toBe(true);
  });

  test("gpt-5, gpt-5.1, and generic models do not support xhigh", () => {
    expect(supportsXHighReasoning("openai", "gpt-5")).toBe(false);
    expect(supportsXHighReasoning("openai", "gpt-5.1")).toBe(false);
    expect(supportsXHighReasoning("openai", "o3")).toBe(false);
  });

  test("google does not support xhigh", () => {
    expect(supportsXHighReasoning("google", "gemini-2.5-pro")).toBe(false);
  });

  test("is case-insensitive and strips provider prefix + date suffix", () => {
    expect(supportsXHighReasoning("Anthropic", "Claude-Opus-4")).toBe(true);
    expect(supportsXHighReasoning("openai", "openai/gpt-5.2-2026-07-01")).toBe(true);
  });
});

describe("supportedReasoningOptions per-model matrix", () => {
  test("binary thinking providers collapse to Default/Thinking", () => {
    expect(supportedReasoningOptions("z.ai", "glm-5.2")).toEqual([
      { value: "", label: "Default" },
      { value: "medium", label: "Thinking" },
    ]);
    expect(supportedReasoningOptions("qwen-portal", "x").length).toBe(2);
  });

  test("codex models expose Low..Max and exclude Minimal", () => {
    const codex = supportedReasoningOptions("openai", "gpt-5.3-codex");
    expect(codex.map((o) => o.value)).toEqual(["", "low", "medium", "high", "xhigh"]);
    expect(codex[codex.length - 1]).toEqual({ value: "xhigh", label: "Max" });
  });

  test("gpt-5.2+ excludes Minimal and adds Max", () => {
    expect(supportedReasoningOptions("openai", "gpt-5.2").map((o) => o.value)).toEqual([
      "",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("gpt-5.1 excludes Minimal and Max", () => {
    expect(supportedReasoningOptions("openai", "gpt-5.1").map((o) => o.value)).toEqual([
      "",
      "low",
      "medium",
      "high",
    ]);
  });

  test("gpt-5 keeps Minimal but no Max", () => {
    expect(supportedReasoningOptions("openai", "gpt-5").map((o) => o.value)).toEqual([
      "",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });

  test("codex-mini is Default/Medium only", () => {
    expect(supportedReasoningOptions("openai", "gpt-5.1-codex-mini").map((o) => o.value)).toEqual([
      "",
      "medium",
    ]);
  });

  test("gpt-5-pro is Default/High only", () => {
    expect(supportedReasoningOptions("openai", "gpt-5-pro").map((o) => o.value)).toEqual([
      "",
      "high",
    ]);
  });

  test("google yields Minimal..High plus default", () => {
    expect(supportedReasoningOptions("google", "gemini-2.5-pro").map((o) => o.value)).toEqual([
      "",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });

  test("anthropic yields the full ladder including Max", () => {
    const anthropic = supportedReasoningOptions("anthropic", "claude-opus-4");
    expect(anthropic.map((o) => o.value)).toEqual([
      "",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("unknown provider gets Default/Low/Medium/High", () => {
    expect(supportedReasoningOptions("groq", "llama-3.3-70b").map((o) => o.value)).toEqual([
      "",
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("reasoningEffortLabel", () => {
  test("empty effort is Default", () => {
    expect(reasoningEffortLabel(null)).toBe("Default");
    expect(reasoningEffortLabel("")).toBe("Default");
  });

  test("maps known efforts to labels", () => {
    expect(reasoningEffortLabel("minimal", "google", "gemini-2.5-pro")).toBe("Minimal");
    expect(reasoningEffortLabel("high", "google", "gemini-2.5-pro")).toBe("High");
    expect(reasoningEffortLabel("xhigh", "openai", "gpt-5.2")).toBe("Max");
  });

  test("unknown effort falls back to Default", () => {
    expect(reasoningEffortLabel("turbo", "openai", "gpt-5.2")).toBe("Default");
  });

  test("binary provider labels medium as Thinking", () => {
    expect(reasoningEffortLabel("medium", "z.ai", "glm-5.2")).toBe("Thinking");
  });
});
