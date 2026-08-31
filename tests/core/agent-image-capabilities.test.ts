import { describe, expect, test } from "bun:test";
import {
  agentImageSupportById,
  agentSupportsImages,
} from "../../src/core/agent-image-capabilities";
import { tables } from "../../src/core/database";
import { providerManager } from "../../src/core/providers";

describe("agent image capabilities", () => {
  test("uses provider model metadata instead of model-name guesses", () => {
    const provider = providerManager.create({
      name: "Image capability test",
      provider: "minimax",
      api_key: "test-key",
    });
    expect(agentSupportsImages({ provider_id: provider.id, model: "MiniMax-M3" })).toBe(true);
    expect(agentSupportsImages({ provider_id: provider.id, model: "MiniMax-M2.7" })).toBe(false);
  });

  test("recognizes GLM-5.3 Flash as multimodal on the Z.AI Coding Plan", () => {
    const provider = providerManager.create({
      name: "Z.AI image capability test",
      provider: "z.ai-coding",
      api_key: "test-key",
    });
    expect(agentSupportsImages({ provider_id: provider.id, model: "glm-5.3-flash" })).toBe(true);
    expect(agentSupportsImages({ provider_id: provider.id, model: "glm-5.3" })).toBe(false);
  });

  test("recognizes new Qwen and DeepSeek vision catalog models", () => {
    const qwenProvider = providerManager.create({
      name: "Qwen image capability test",
      provider: "qwen-token-plan",
      api_key: "test-key",
    });
    const deepSeekProvider = providerManager.create({
      name: "DeepSeek image capability test",
      provider: "deepseek",
      api_key: "test-key",
    });
    expect(agentSupportsImages({ provider_id: qwenProvider.id, model: "qwen3.8-flash" })).toBe(
      true
    );
    expect(
      agentSupportsImages({
        provider_id: deepSeekProvider.id,
        model: "deepseek-v4-flash-vision-exp",
      })
    ).toBe(true);
    expect(
      agentSupportsImages({ provider_id: deepSeekProvider.id, model: "deepseek-v4-flash" })
    ).toBe(false);
  });

  test("allows explicit image capability for custom and local models", () => {
    const provider = providerManager.create({
      name: "Custom image capability test",
      provider: "custom",
      api_key: "test-key",
      base_url: "http://127.0.0.1:8000/v1",
    });
    expect(
      agentSupportsImages({
        provider_id: provider.id,
        model: "local-vision-model",
        config: { image_input: "enabled" },
      })
    ).toBe(true);
    expect(
      agentSupportsImages({
        provider_id: provider.id,
        model: "local-vision-model",
        config: { image_input: "disabled" },
      })
    ).toBe(false);
  });

  test("resolves multiple agent capabilities through the batch model lookup", () => {
    const provider = providerManager.create({
      name: "Batch image capability test",
      provider: "minimax",
      api_key: "test-key",
    });
    const support = agentImageSupportById([
      { id: "vision", provider_id: provider.id, model: "MiniMax-M3" },
      { id: "text", provider_id: provider.id, model: "MiniMax-M2.7" },
      {
        id: "override",
        provider_id: provider.id,
        model: "MiniMax-M2.7",
        config: { supports_images: true },
      },
      { id: "missing-provider", provider_id: "", model: "MiniMax-M3" },
    ]);
    expect(support.get("vision")).toBe(true);
    expect(support.get("text")).toBe(false);
    expect(support.get("override")).toBe(true);
    expect(support.get("missing-provider")).toBe(false);
  });

  test("does not scan unrelated provider model rows", () => {
    const provider = providerManager.create({
      name: "Targeted batch capability test",
      provider: "minimax",
      api_key: "test-key",
    });
    const originalAll = tables.providerModels.all;
    tables.providerModels.all = () => {
      throw new Error("full provider model scan");
    };
    try {
      const support = agentImageSupportById([
        { id: "targeted", provider_id: provider.id, model: "MiniMax-M3" },
      ]);
      expect(support.get("targeted")).toBe(true);
    } finally {
      tables.providerModels.all = originalAll;
    }
  });

  test("removes cached models when their provider is deleted", () => {
    const provider = providerManager.create({
      name: "Provider model cleanup test",
      provider: "minimax",
      api_key: "test-key",
    });
    tables.providerModels.upsert({
      id: crypto.randomUUID(),
      provider_id: provider.id,
      model_id: "cleanup-model",
    });
    expect(
      (tables.providerModels.byProvider(provider.id) as Array<{ model_id: string }>).some(
        (model) => model.model_id === "cleanup-model"
      )
    ).toBe(true);
    expect(providerManager.delete(provider.id)).toBe(true);
    expect(tables.providerModels.byProvider(provider.id)).toHaveLength(0);
  });

  test("rejects cached models whose provider does not exist", () => {
    const providerId = crypto.randomUUID();
    expect(() =>
      tables.providerModels.upsert({
        id: crypto.randomUUID(),
        provider_id: providerId,
        model_id: "orphan-model",
      })
    ).toThrow();
    expect(tables.providerModels.byProvider(providerId)).toHaveLength(0);
  });
});
