import { describe, expect, test } from "bun:test";
import { resolveModelAlias } from "../../src/core/system-prompt";

describe("Model alias compatibility", () => {
  test("normalizes Anthropic 4.6 dot and provider-qualified aliases", () => {
    expect(resolveModelAlias("claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("anthropic/claude-opus-4-6")).toBe("claude-opus-4-6");
  });

  test("maps current Anthropic family aliases to Claude 5", () => {
    expect(resolveModelAlias("opus")).toBe("claude-opus-5");
    expect(resolveModelAlias("opus-5")).toBe("claude-opus-5");
    expect(resolveModelAlias("claude-opus")).toBe("claude-opus-5");
    expect(resolveModelAlias("sonnet")).toBe("claude-sonnet-5");
    expect(resolveModelAlias("smart")).toBe("claude-opus-5");
  });

  test("maps codex forward-compat aliases to GPT-5.3 Codex", () => {
    expect(resolveModelAlias("gpt-5-codex")).toBe("gpt-5.3-codex");
    expect(resolveModelAlias("gpt-5.2-codex", "openai-codex")).toBe("gpt-5.3-codex");
  });

  test("maps MiniMax aliases to M2.5 generation defaults", () => {
    expect(resolveModelAlias("minimax")).toBe("MiniMax-M2.5");
    expect(resolveModelAlias("minimax-m2.5-highspeed")).toBe("MiniMax-M2.5-highspeed");
    expect(resolveModelAlias("minimax-m2.5-lightning")).toBe("MiniMax-M2.5-Lightning");
    expect(resolveModelAlias("fast")).toBe("MiniMax-M2.5-highspeed");
  });

  test("maps Qwen 3.8 Flash Next names to provider-compatible IDs", () => {
    expect(resolveModelAlias("qwen3.8-next-flash", "alibaba")).toBe("qwen3.8-flash");
    expect(resolveModelAlias("qwen3.8-next-flash", "qwen-token-plan")).toBe("qwen3.8-flash");
    expect(resolveModelAlias("qwen3.8-flash-next", "qwen-token-plan-cn")).toBe("qwen3.8-flash");
    expect(resolveModelAlias("qwen3.8-next-flash", "custom")).toBe("Qwen/Qwen3.8-Flash-Next");
  });

  test("keeps unknown models unchanged", () => {
    expect(resolveModelAlias("custom-provider-model")).toBe("custom-provider-model");
  });
});
