import { describe, expect, test } from "bun:test";
import { resolveModelAlias } from "../../src/core/system-prompt";

describe("Model alias compatibility", () => {
  test("normalizes Anthropic 4.6 dot and provider-qualified aliases", () => {
    expect(resolveModelAlias("claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("anthropic/claude-opus-4-6")).toBe("claude-opus-4-6");
  });

  test("maps codex forward-compat aliases to GPT-5.3 Codex", () => {
    expect(resolveModelAlias("gpt-5-codex")).toBe("gpt-5.3-codex");
    expect(resolveModelAlias("gpt-5.2-codex", "openai-codex")).toBe("gpt-5.3-codex");
  });

  test("keeps unknown models unchanged", () => {
    expect(resolveModelAlias("custom-provider-model")).toBe("custom-provider-model");
  });
});
