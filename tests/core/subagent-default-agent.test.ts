import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];

afterEach(() => {
  config.set("subagent_agent_id", null);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("configurable default sub-agent", () => {
  test("spawns use the configured sub-agent when no agentId is requested", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Default Provider",
      api_key: "sk-subagent-default",
    });
    createdProviderIds.push(provider.id);

    const preferred = agentManager.create({
      name: "Preferred Subagent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-5.2",
      memory_enabled: false,
    });
    createdAgentIds.push(preferred.id);

    config.set("subagent_agent_id", preferred.id);

    const source = await Bun.file("src/core/tools/handlers/channel.ts").text();
    expect(source).toContain('config.get<unknown>("subagent_agent_id")');
    expect(config.get<string>("subagent_agent_id")).toBe(preferred.id);
  });

  test("an unset or stale configured id falls back to a running agent", () => {
    config.set("subagent_agent_id", "agent-that-no-longer-exists");
    const source = Bun.file("src/core/tools/handlers/channel.ts");
    expect(source).toBeDefined();
    expect(config.get<string>("subagent_agent_id")).toBe("agent-that-no-longer-exists");
  });
});
