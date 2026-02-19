import { describe, expect, test } from "bun:test";
import {
  getDefaultModel,
  getProviderBaseUrl,
  providers,
  resolveProviderType,
} from "../../src/core/providers";

describe("Provider model defaults and API-family parity", () => {
  test("uses updated defaults for OpenClaw-parity providers", () => {
    expect(getDefaultModel("openai")).toBe("gpt-5.2");
    expect(getDefaultModel("minimax")).toBe("MiniMax-M2.5");
    expect(getDefaultModel("minimax-portal")).toBe("MiniMax-M2.5");
    expect(getDefaultModel("moonshot")).toBe("kimi-k2.5");
    expect(getDefaultModel("litellm")).toBe("gpt-4o");
    expect(getDefaultModel("z.ai")).toBe("glm-5");
    expect(getDefaultModel("zai")).toBe("glm-5");
    expect(getDefaultModel("antigravity")).toBe("gemini-3-pro-preview");
    expect(getDefaultModel("google-antigravity")).toBe("gemini-3-pro-preview");
    expect(getDefaultModel("opencode_zen")).toBe("claude-sonnet-4-6");
    expect(getDefaultModel("opencode")).toBe("claude-sonnet-4-6");
    expect(getDefaultModel("openai-codex")).toBe("gpt-5.3-codex");
    expect(getDefaultModel("github_copilot")).toBe("gpt-4o");
    expect(getDefaultModel("github-copilot")).toBe("gpt-4o");
    expect(getDefaultModel("kimi-coding")).toBe("kimi-for-coding");
    expect(getDefaultModel("qianfan")).toBe("deepseek-v3.2");
  });

  test("normalizes OpenClaw-style provider aliases", () => {
    expect(resolveProviderType("github-copilot")).toBe("github_copilot");
    expect(resolveProviderType("google-antigravity")).toBe("antigravity");
    expect(resolveProviderType("opencode")).toBe("opencode_zen");
    expect(resolveProviderType("zai")).toBe("z.ai");
    expect(resolveProviderType("kimi-coding")).toBe("kimi-code");
    expect(getProviderBaseUrl("opencode")).toBe("https://opencode.ai/zen/v1");
  });

  test("declares expected API-family names for compatibility methods", () => {
    expect(providers.ollama.api).toBe("ollama");
    expect(providers["openai-codex"].api).toBe("openai-codex-responses");
    expect(providers.vllm.api).toBe("openai-completions");
    expect(providers.litellm.api).toBe("openai-completions");
    expect(providers.together.api).toBe("openai-completions");
    expect(providers.huggingface.api).toBe("openai-completions");
    expect(providers["cloudflare-ai-gateway"].api).toBe("anthropic-messages");
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

  test("includes newly added provider catalogs from OpenClaw parity set", () => {
    expect(providers["minimax-portal"].models.some((model) => model.id === "MiniMax-M2.5")).toBe(true);
    expect(providers.together.models.some((model) => model.id === "moonshotai/Kimi-K2.5")).toBe(true);
    expect(providers.huggingface.models.some((model) => model.id === "openai/gpt-oss-120b")).toBe(
      true
    );
    expect(
      providers.nvidia.models.some((model) => model.id === "nvidia/llama-3.1-nemotron-70b-instruct")
    ).toBe(true);
  });

  test("uses current MiniMax IDs and output/context caps", () => {
    const minimaxIds = providers.minimax.models.map((model) => model.id);
    expect(minimaxIds).toEqual(
      expect.arrayContaining([
        "MiniMax-M2.5",
        "MiniMax-M2.5-highspeed",
        "MiniMax-M2",
        "MiniMax-M2.1",
        "MiniMax-M2.1-highspeed",
      ])
    );
    const m25 = providers.minimax.models.find((model) => model.id === "MiniMax-M2.5");
    expect(m25?.context).toBe(204800);
    expect(m25?.maxTokens).toBe(64000);
    expect(providers["minimax-portal"].baseUrl).toBe("https://api.minimax.io/anthropic/v1");
  });

  test("includes current Qianfan defaults plus legacy compatibility models", () => {
    const qianfanModelIds = providers.qianfan.models.map((model) => model.id);
    expect(qianfanModelIds).toEqual(
      expect.arrayContaining([
        "deepseek-v3.2",
        "ernie-5.0-thinking-preview",
        "ernie-5.0",
        "ernie-4.5",
      ])
    );
  });
});
