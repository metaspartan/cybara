import { describe, expect, test } from "bun:test";
import { getDefaultModel, providers } from "../../src/core/providers";

describe("Provider model defaults and API-family parity", () => {
  test("uses updated defaults for OpenClaw-parity providers", () => {
    expect(getDefaultModel("openai")).toBe("gpt-5.2");
    expect(getDefaultModel("antigravity")).toBe("gemini-3-pro-preview");
    expect(getDefaultModel("google-antigravity")).toBe("gemini-3-pro-preview");
    expect(getDefaultModel("opencode_zen")).toBe("claude-sonnet-4-6");
    expect(getDefaultModel("openai-codex")).toBe("gpt-5.3-codex");
    expect(getDefaultModel("github_copilot")).toBe("gpt-4o");
  });

  test("declares expected API-family names for compatibility methods", () => {
    expect(providers.ollama.api).toBe("ollama");
    expect(providers["openai-codex"].api).toBe("openai-codex-responses");
  });

  test("includes GPT-5.3 Codex in the OpenAI Codex model catalog", () => {
    const codexModelIds = providers["openai-codex"].models.map((model) => model.id);
    expect(codexModelIds).toContain("gpt-5.3-codex");
  });

  test("includes default GitHub Copilot model ids for broad plan compatibility", () => {
    const copilotModelIds = providers.github_copilot.models.map((model) => model.id);
    expect(copilotModelIds).toEqual(
      expect.arrayContaining([
        "gpt-4o",
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4.1-nano",
        "o1",
        "o1-mini",
        "o3-mini",
      ])
    );
  });
});
