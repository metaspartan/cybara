import { describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import db, { tables } from "../../src/core/database";
import { providerManager } from "../../src/core/providers";

function createCodexProvider(): string {
  const providerId = `codex-validate-${crypto.randomUUID()}`;
  tables.providers.create({
    id: providerId,
    provider: "openai-codex",
    name: "Codex Validate",
    base_url: "https://chatgpt.com/backend-api",
    is_default: false,
  });
  return providerId;
}

function cleanup(providerId: string, agentIds: string[]): void {
  for (const agentId of agentIds) {
    db.query("DELETE FROM agents WHERE id = ?").run(agentId);
  }
  db.query("DELETE FROM provider_models WHERE provider_id = ?").run(providerId);
  tables.providers.delete(providerId);
}

describe("agent model validation", () => {
  test("rejects a model outside the provider's discovered list and keeps the previous model", () => {
    const providerId = createCodexProvider();
    providerManager.setAuthoritativeModels(providerId, ["gpt-5.6-sol", "gpt-5.5"]);
    const agent = agentManager.create({
      name: "Model Validate",
      provider_id: providerId,
      model: "gpt-5.6-sol",
    });
    try {
      expect(() => agentManager.update(agent.id, { model: "totally-unknown-model" })).toThrow(
        "Validation error: Unknown model totally-unknown-model"
      );
      expect(agentManager.get(agent.id)?.model).toBe("gpt-5.6-sol");
    } finally {
      cleanup(providerId, [agent.id]);
    }
  });

  test("accepts a model in the provider's discovered list", () => {
    const providerId = createCodexProvider();
    providerManager.setAuthoritativeModels(providerId, ["gpt-5.6-sol", "gpt-5.5"]);
    const agent = agentManager.create({
      name: "Model Validate",
      provider_id: providerId,
      model: "gpt-5.6-sol",
    });
    try {
      const updated = agentManager.update(agent.id, { model: "gpt-5.5" });
      expect(updated?.model).toBe("gpt-5.5");
    } finally {
      cleanup(providerId, [agent.id]);
    }
  });

  test("rejects an unknown model on create when the provider list is discovered", () => {
    const providerId = createCodexProvider();
    providerManager.setAuthoritativeModels(providerId, ["gpt-5.6-sol"]);
    try {
      expect(() =>
        agentManager.create({
          name: "Model Validate",
          provider_id: providerId,
          model: "totally-unknown-model",
        })
      ).toThrow("Validation error: Unknown model totally-unknown-model");
    } finally {
      cleanup(providerId, []);
    }
  });

  test("allows arbitrary models when the endpoint has no discovered list", () => {
    const providerId = createCodexProvider();
    let agentId: string | undefined;
    try {
      const agent = agentManager.create({
        name: "Custom Model",
        provider_id: providerId,
        model: "totally-unknown-model",
      });
      agentId = agent.id;
      expect(agent.model).toBe("totally-unknown-model");
      const updated = agentManager.update(agent.id, { model: "another-custom-model" });
      expect(updated?.model).toBe("another-custom-model");
    } finally {
      cleanup(providerId, agentId ? [agentId] : []);
    }
  });
});
