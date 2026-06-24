import { describe, expect, test } from "bun:test";
import db, { tables } from "../../src/core/database";
import {
  getDefaultModel,
  getProviderBaseUrl,
  providerManager,
  providers,
  resolveProviderType,
} from "../../src/core/providers";

describe("Provider model defaults and API-family parity", () => {
  test("uses updated defaults for OpenClaw-parity providers", () => {
    expect(getDefaultModel("openai")).toBe("gpt-5.5");
    expect(getDefaultModel("anthropic")).toBe("claude-opus-4-8");
    expect(getDefaultModel("minimax")).toBe("MiniMax-M3");
    expect(getDefaultModel("minimax-portal")).toBe("MiniMax-M3");
    expect(getDefaultModel("moonshot")).toBe("kimi-k2.6");
    expect(getDefaultModel("litellm")).toBe("gpt-4o");
    expect(getDefaultModel("z.ai")).toBe("glm-5.2");
    expect(getDefaultModel("zai")).toBe("glm-5.2");
    expect(getDefaultModel("z.ai-coding")).toBe("glm-5.2");
    expect(getDefaultModel("antigravity")).toBe("gemini-3.1-pro-preview");
    expect(getDefaultModel("google-antigravity")).toBe("gemini-3.1-pro-preview");
    expect(getDefaultModel("google-gemini-cli")).toBe("gemini-3.1-pro-preview");
    expect(getDefaultModel("gemini-cli")).toBe("gemini-3.1-pro-preview");
    expect(getDefaultModel("opencode_zen")).toBe("claude-opus-4-8");
    expect(getDefaultModel("opencode")).toBe("claude-opus-4-8");
    expect(getDefaultModel("openai-codex")).toBe("gpt-5.5");
    expect(getDefaultModel("github_copilot")).toBe("gpt-5.5");
    expect(getDefaultModel("github-copilot")).toBe("gpt-5.5");
    expect(getDefaultModel("kimi-coding")).toBe("kimi-for-coding");
    expect(getDefaultModel("qianfan")).toBe("deepseek-v3.2");
    expect(getDefaultModel("deepseek")).toBe("deepseek-v4-flash");
    expect(getDefaultModel("alibaba")).toBe("qwen3.6-plus");
    expect(getDefaultModel("xiaomi")).toBe("mimo-v2.5-pro");
    expect(getDefaultModel("nvidia")).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(getDefaultModel("ollama-cloud")).toBe("glm-5.2:cloud");
  });

  test("normalizes OpenClaw-style provider aliases", () => {
    expect(resolveProviderType("github-copilot")).toBe("github_copilot");
    expect(resolveProviderType("google-antigravity")).toBe("antigravity");
    expect(resolveProviderType("gemini-cli")).toBe("google-gemini-cli");
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
    expect(codexModelIds).toContain("gpt-5.2-codex");
    expect(codexModelIds).toContain("gpt-5.3-codex-spark");
    expect(codexModelIds).toContain("gpt-5.1-codex-max");
    expect(providers["openai-codex"].baseUrl).toBe("https://chatgpt.com/backend-api");
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
    expect(providers["minimax-portal"].models.some((model) => model.id === "MiniMax-M2.5")).toBe(
      true
    );
    expect(providers.together.models.some((model) => model.id === "moonshotai/Kimi-K2.5")).toBe(
      true
    );
    expect(providers.huggingface.models.some((model) => model.id === "openai/gpt-oss-120b")).toBe(
      true
    );
    expect(
      providers.nvidia.models.some((model) => model.id === "nvidia/llama-3.1-nemotron-70b-instruct")
    ).toBe(true);
  });

  test("configures google-gemini-cli for redirect OAuth like OpenClaw", () => {
    expect(providers["google-gemini-cli"].authType).toBe("oauth");
    expect(providers["google-gemini-cli"].oauthFlow).toBe("redirect");
    expect(providers["google-gemini-cli"].oauthConfig).toBeDefined();
    expect(providers["google-gemini-cli"].oauthConfig?.authorizeUrl).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(providers["google-gemini-cli"].oauthConfig?.tokenUrl).toBe(
      "https://oauth2.googleapis.com/token"
    );
    expect(providers["google-gemini-cli"].oauthConfig?.callbackPort).toBe(8085);
    expect(providers["google-gemini-cli"].oauthConfig?.callbackPath).toBe("/oauth2callback");
  });

  test("configures openai-codex for ChatGPT OAuth like OpenClaw", () => {
    expect(providers["openai-codex"].authType).toBe("oauth");
    expect(providers["openai-codex"].oauthFlow).toBe("redirect");
    expect(providers["openai-codex"].oauthConfig).toBeDefined();
    expect(providers["openai-codex"].oauthConfig?.authorizeUrl).toBe(
      "https://auth.openai.com/oauth/authorize"
    );
    expect(providers["openai-codex"].oauthConfig?.tokenUrl).toBe(
      "https://auth.openai.com/oauth/token"
    );
    expect(providers["openai-codex"].oauthConfig?.clientId).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(providers["openai-codex"].oauthConfig?.callbackPort).toBe(1455);
    expect(providers["openai-codex"].oauthConfig?.callbackPath).toBe("/auth/callback");
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

  test("merges static catalog models into stale provider model cache", () => {
    const providerId = `google-cache-${crypto.randomUUID()}`;

    tables.providers.create({
      id: providerId,
      provider: "google",
      name: "Google Cache Test",
      base_url: providers.google.baseUrl,
      is_default: false,
    });

    tables.providerModels.upsert({
      id: `${providerId}-legacy`,
      provider_id: providerId,
      model_id: "gemini-3-pro-preview",
      model_name: "Gemini 3 Pro",
      context_window: 1048576,
      max_tokens: 65536,
      reasoning: false,
      input_types: ["text", "image", "audio", "video"],
    });

    const modelIds = providerManager.getModels(providerId).map((model) => model.model_id);
    expect(modelIds).toContain("gemini-3.1-pro-preview");
    expect(modelIds).toContain("gemini-3-pro-preview");

    db.query("DELETE FROM provider_models WHERE provider_id = ?").run(providerId);
    tables.providers.delete(providerId);
  });
});
