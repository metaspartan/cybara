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

  test("resolves multiple agent capabilities through the batch model lookup", () => {
    const provider = providerManager.create({
      name: "Batch image capability test",
      provider: "minimax",
      api_key: "test-key",
    });
    const support = agentImageSupportById([
      { id: "vision", provider_id: provider.id, model: "MiniMax-M3" },
      { id: "text", provider_id: provider.id, model: "MiniMax-M2.7" },
      { id: "missing-provider", provider_id: "", model: "MiniMax-M3" },
    ]);
    expect(support.get("vision")).toBe(true);
    expect(support.get("text")).toBe(false);
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

  test("prunes cached models whose provider no longer exists", () => {
    const providerId = crypto.randomUUID();
    tables.providerModels.upsert({
      id: crypto.randomUUID(),
      provider_id: providerId,
      model_id: "orphan-model",
    });
    expect(tables.providerModels.byProvider(providerId)).toHaveLength(1);
    tables.providerModels.deleteOrphans();
    expect(tables.providerModels.byProvider(providerId)).toHaveLength(0);
  });
});
