import { describe, expect, test } from "bun:test";
import db, { tables } from "../../src/core/database";
import {
  getDefaultModel,
  getProviderBaseUrl,
  providerManager,
  providers,
  resolveProviderType,
  shouldSeedProvider,
} from "../../src/core/providers";

describe("Provider model defaults and API-family parity", () => {
  test("uses updated defaults for newly added providers", () => {
    expect(getDefaultModel("openai")).toBe("gpt-5.6-sol");
    expect(getDefaultModel("meta")).toBe("muse-spark-1.1");
    expect(getDefaultModel("ds4")).toBe("deepseek-v4-flash");
    expect(getDefaultModel("inferrs")).toBe("google/gemma-4-E2B-it");
    expect(getDefaultModel("anthropic")).toBe("claude-opus-4-8");
    expect(getDefaultModel("anthropic-oauth")).toBe("claude-opus-4-8");
    expect(getDefaultModel("cursor")).toBe("default");
    expect(getDefaultModel("devin")).toBe("claude-sonnet-5-medium");
    expect(getDefaultModel("gitlab-duo")).toBe("duo-chat-sonnet-4-6");
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
    expect(getDefaultModel("openai-codex")).toBe("gpt-5.6-sol");
    expect(getDefaultModel("chutes")).toBe("Qwen/Qwen3-32B-TEE");
    expect(getDefaultModel("featherless")).toBe("Qwen/Qwen3-32B");
    expect(getDefaultModel("longcat")).toBe("LongCat-2.0");
    expect(getDefaultModel("github_copilot")).toBe("gpt-5.5");
    expect(getDefaultModel("github-copilot")).toBe("gpt-5.5");
    expect(getDefaultModel("kimi-coding")).toBe("kimi-for-coding");
    expect(getDefaultModel("qianfan")).toBe("deepseek-v3.2");
    expect(getDefaultModel("xai")).toBe("grok-4.3");
    expect(getDefaultModel("xai-oauth")).toBe("grok-build-0.1");
    expect(getDefaultModel("grok-oauth")).toBe("grok-build-0.1");
    expect(getDefaultModel("grok-build")).toBe("grok-build-0.1");
    expect(getDefaultModel("deepseek")).toBe("deepseek-v4-flash");
    expect(getDefaultModel("alibaba")).toBe("qwen3.6-plus");
    expect(getDefaultModel("xiaomi")).toBe("mimo-v2.5-pro");
    expect(getDefaultModel("nvidia")).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(getDefaultModel("ollama-cloud")).toBe("glm-5.2:cloud");
  });

  test("normalizes provider aliases", () => {
    expect(resolveProviderType("github-copilot")).toBe("github_copilot");
    expect(resolveProviderType("claude-oauth")).toBe("anthropic-oauth");
    expect(resolveProviderType("cursor-oauth")).toBe("cursor");
    expect(resolveProviderType("devin-oauth")).toBe("devin");
    expect(resolveProviderType("google-antigravity")).toBe("antigravity");
    expect(resolveProviderType("gemini-cli")).toBe("google-gemini-cli");
    expect(resolveProviderType("opencode")).toBe("opencode_zen");
    expect(resolveProviderType("zai")).toBe("z.ai");
    expect(resolveProviderType("kimi-coding")).toBe("kimi-code");
    expect(resolveProviderType("grok-oauth")).toBe("xai-oauth");
    expect(resolveProviderType("grok-build")).toBe("xai-oauth");
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
    expect(providers.chutes.api).toBe("openai-completions");
    expect(providers.featherless.api).toBe("openai-completions");
    expect(providers.longcat.api).toBe("openai-completions");
    expect(providers.xai.api).toBe("openai-responses");
    expect(providers["xai-oauth"].api).toBe("openai-responses");
    expect(providers.meta.api).toBe("openai-responses");
    expect(providers.ds4.api).toBe("openai-completions");
    expect(providers.inferrs.api).toBe("openai-completions");
    expect(providers["anthropic-oauth"].api).toBe("anthropic-messages");
    expect(providers.cursor.api).toBe("cursor-agent");
    expect(providers.devin.api).toBe("devin-agent");
    expect(providers["gitlab-duo"].api).toBe("gitlab-duo");
  });

  test("includes current OpenAI preview models in API and Codex catalogs", () => {
    const openAiModelIds = providers.openai.models.map((model) => model.id);
    const codexModelIds = providers["openai-codex"].models.map((model) => model.id);
    expect(openAiModelIds).toContain("gpt-5.6");
    for (const modelId of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(openAiModelIds).toContain(modelId);
      expect(codexModelIds).toContain(modelId);
    }
    for (const modelId of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      const apiModel = providers.openai.models.find((model) => model.id === modelId);
      const codexModel = providers["openai-codex"].models.find((model) => model.id === modelId);
      expect(apiModel?.context).toBe(1050000);
      expect(codexModel?.context).toBe(372000);
    }
    expect(providers["openai-codex"].models.find((model) => model.id === "gpt-5.6-sol")?.name).toBe(
      "GPT-5.6-Sol"
    );
    expect(codexModelIds).toContain("gpt-5.3-codex");
    expect(codexModelIds).toContain("gpt-5.2-codex");
    expect(codexModelIds).toContain("gpt-5.3-codex-spark");
    expect(codexModelIds).toContain("gpt-5.1-codex-max");
    expect(providers["openai-codex"].baseUrl).toBe("https://chatgpt.com/backend-api");
  });

  test("keeps current provider catalogs free of duplicate model ids", () => {
    for (const provider of Object.values(providers)) {
      const modelIds = provider.models.map((model) => model.id);
      expect(new Set(modelIds).size).toBe(modelIds.length);
    }
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

  test("includes native account OAuth provider definitions", () => {
    expect(providers["anthropic-oauth"].oauthFlow).toBe("redirect");
    expect(providers["anthropic-oauth"].models.length).toBe(providers.anthropic.models.length);
    expect(providers.cursor.oauthFlow).toBe("device_code");
    expect(providers.cursor.models.length).toBe(42);
    expect(providers.devin.oauthFlow).toBe("redirect");
    expect(providers.devin.models.length).toBe(59);
    expect(providers["gitlab-duo"].models.length).toBe(10);
    expect(providers.meta.models.some((model) => model.id === "muse-spark-1.1")).toBe(true);
    expect(providers.ds4.models.some((model) => model.id === "deepseek-v4-flash")).toBe(true);
    expect(providers.inferrs.models.some((model) => model.id === "google/gemma-4-E2B-it")).toBe(
      true
    );
    expect(providers.anthropic.models.some((model) => model.id === "claude-mythos-5")).toBe(true);
    expect(providers.groq.models.some((model) => model.id === "groq/compound")).toBe(true);
    expect(providers.cohere.models.some((model) => model.id === "command-a-plus-05-2026")).toBe(
      true
    );
    expect(providers.chutes.models.length).toBeGreaterThan(40);
    expect(providers.venice.models.length).toBeGreaterThan(30);
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
    expect(providers.chutes.baseUrl).toBe("https://llm.chutes.ai/v1");
    expect(providers.chutes.authType).toBe("api_key");
    expect(providers.featherless.models.some((model) => model.id === "Qwen/Qwen3-32B")).toBe(true);
    expect(providers.longcat.models.some((model) => model.id === "LongCat-2.0")).toBe(true);
    expect(providers.xai.models.some((model) => model.id === "grok-4.5")).toBe(true);
    const openCodeZenIds = providers.opencode_zen.models.map((model) => model.id);
    expect(openCodeZenIds).toEqual(
      expect.arrayContaining([
        "claude-fable-5",
        "claude-sonnet-5",
        "gemini-3.5-flash",
        "gpt-5.5",
        "gpt-5.3-codex-spark",
        "grok-4.5",
        "kimi-k2.7-code",
        "minimax-m3",
      ])
    );
    const openCodeGoIds = providers["opencode-go"].models.map((model) => model.id);
    expect(openCodeGoIds).toEqual(
      expect.arrayContaining([
        "glm-5.2",
        "kimi-k2.7-code",
        "minimax-m3",
        "qwen3.7-max",
        "qwen3.7-plus",
        "mimo-v2.5-pro",
        "hy3-preview",
      ])
    );
    const antigravityIds = providers.antigravity.models.map((model) => model.id);
    expect(antigravityIds).toEqual(
      expect.arrayContaining([
        "gemini-3.1-pro-preview",
        "gemini-3.1-pro-preview-customtools",
        "gemini-3-flash-preview",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
      ])
    );
  });

  test("configures google-gemini-cli for redirect OAuth", () => {
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

  test("configures openai-codex for ChatGPT OAuth", () => {
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

  test("configures xAI Grok OAuth for device-code login", () => {
    const provider = providers["xai-oauth"];
    expect(provider.name).toBe("xAI Grok OAuth");
    expect(provider.authType).toBe("oauth");
    expect(provider.oauthFlow).toBe("device_code");
    expect(provider.oauthConfig?.clientId).toBe("b1a00492-073a-47ea-816f-4c329264a828");
    expect(provider.oauthConfig?.discoveryUrl).toBe(
      "https://auth.x.ai/.well-known/openid-configuration"
    );
    expect(provider.oauthConfig?.deviceCodeDiscoveryUrl).toBe(
      "https://auth.x.ai/.well-known/openid-configuration"
    );
    expect(provider.oauthConfig?.tokenUrl).toBe("https://auth.x.ai/oauth2/token");
    expect(provider.oauthConfig?.scope).toContain("grok-cli:access");
    expect(provider.oauthConfig?.scope).toContain("api:access");
    const modelIds = provider.models.map((model) => model.id);
    expect(modelIds).toEqual(
      expect.arrayContaining([
        "grok-build-0.1",
        "grok-composer-2.5-fast",
        "grok-4.3",
        "grok-4.5",
        "grok-4.20-0309-reasoning",
        "grok-4.20-0309-non-reasoning",
        "grok-4.20-multi-agent-0309",
        "grok-4-fast-non-reasoning",
        "grok-4-1-fast-non-reasoning",
        "grok-3-mini-fast",
      ])
    );
    const grok45 = provider.models.find((model) => model.id === "grok-4.5");
    expect(grok45?.context).toBe(500000);
    expect(grok45?.reasoning).toBe(true);
    expect(grok45?.input).toEqual(["text", "image"]);
  });

  test("configures MiniMax Portal for PKCE user-code login", () => {
    const provider = providers["minimax-portal"];
    expect(provider.authType).toBe("oauth");
    expect(provider.oauthFlow).toBe("device_code");
    expect(provider.oauthConfig.clientId).toBe("78257093-7e40-4613-99e0-527b14b39113");
    expect(provider.oauthConfig.deviceCodeUrl).toBe(
      "https://account.minimax.io/oauth2/device/code"
    );
    expect(provider.oauthConfig.tokenUrl).toBe("https://account.minimax.io/oauth2/token");
    expect(provider.oauthConfig.scope).toBe("group_id profile model.completion");
  });

  test("does not advertise non-interactive portal credentials as OAuth", () => {
    expect(providers["qwen-portal"].authType).toBe("token");
    expect(providers["copilot-proxy"].authType).toBe("none");
  });

  test("only seeds providers that work without stored credentials", () => {
    expect(shouldSeedProvider("none")).toBe(true);
    expect(shouldSeedProvider("aws-sdk")).toBe(true);
    expect(shouldSeedProvider("api_key")).toBe(false);
    expect(shouldSeedProvider("oauth")).toBe(false);
    expect(shouldSeedProvider("token")).toBe(false);
    expect(shouldSeedProvider("bearer")).toBe(false);
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
