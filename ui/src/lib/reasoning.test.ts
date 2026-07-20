import { describe, expect, test } from "bun:test";
import {
  parseAgentConfig,
  readAgentReasoningEffort,
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
    expect(supportedReasoningOptions("alibaba", "qwen3.7-plus")).toEqual([
      { value: "", label: "Default" },
      { value: "medium", label: "Thinking" },
    ]);
    expect(supportedReasoningOptions("qwen-token-plan", "qwen3.7-plus")).toEqual([
      { value: "", label: "Default" },
      { value: "medium", label: "Thinking" },
    ]);
  });

  test("MiniMax M3 follows provider-adaptive reasoning", () => {
    expect(supportedReasoningOptions("minimax", "MiniMax-M3")).toEqual([
      { value: "", label: "Adaptive" },
    ]);
    expect(reasoningEffortLabel(null, "minimax-portal", "MiniMax-M3")).toBe("Adaptive");
  });

  test("Kimi K3 exposes its current coding-plan reasoning contract", () => {
    for (const provider of [
      "kimi-code",
      "kimi-code-oauth",
      "kimi-coding",
      "kimi-oauth",
      "kimi-code-subscription",
    ]) {
      expect(supportedReasoningOptions(provider, "k3")).toEqual([
        { value: "", label: "Default" },
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
        { value: "max", label: "Max" },
      ]);
    }
    expect(supportsXHighReasoning("kimi-code-oauth", "k3")).toBe(false);
    expect(reasoningEffortLabel("max", "kimi-code-oauth", "k3")).toBe("Max");
  });

  test("Gemini 3 Flash exposes Minimal through High", () => {
    expect(supportedReasoningOptions("google", "gemini-3.5-flash").map((o) => o.value)).toEqual([
      "",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });

  test("codex models expose Low..Max and exclude Minimal", () => {
    const codex = supportedReasoningOptions("openai", "gpt-5.3-codex");
    expect(codex.map((o) => o.value)).toEqual(["", "low", "medium", "high", "xhigh"]);
    expect(codex[codex.length - 1]).toEqual({ value: "xhigh", label: "Extra High" });
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

  test("google yields documented levels plus default", () => {
    expect(supportedReasoningOptions("google", "gemini-2.5-pro").map((o) => o.value)).toEqual([
      "",
      "low",
      "medium",
      "high",
    ]);
  });

  test("modern anthropic models expose Extra High and Max", () => {
    const anthropic = supportedReasoningOptions("anthropic", "claude-opus-4");
    expect(anthropic.map((o) => o.value)).toEqual(["", "low", "medium", "high", "xhigh", "max"]);
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
    expect(reasoningEffortLabel("high", "google", "gemini-2.5-pro")).toBe("High");
    expect(reasoningEffortLabel("xhigh", "openai", "gpt-5.2")).toBe("Extra High");
  });

  test("unknown effort falls back to Default", () => {
    expect(reasoningEffortLabel("turbo", "openai", "gpt-5.2")).toBe("Default");
  });

  test("binary provider labels medium as Thinking", () => {
    expect(reasoningEffortLabel("medium", "z.ai", "glm-5.2")).toBe("Thinking");
  });
});

describe("agent reasoning persistence", () => {
  test("reads snake-case effort from serialized SQLite JSON", () => {
    const config = JSON.stringify({ model_params: { reasoning_effort: "high" } });
    expect(readAgentReasoningEffort(config)).toBe("high");
    expect(parseAgentConfig(config)).toEqual({ model_params: { reasoning_effort: "high" } });
  });

  test("reads camel-case legacy values and rejects malformed JSON", () => {
    expect(readAgentReasoningEffort({ modelParams: { reasoningEffort: "max" } })).toBe("max");
    expect(readAgentReasoningEffort("{broken")).toBeNull();
  });
});
