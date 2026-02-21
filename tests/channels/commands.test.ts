import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  clearChannelSubagentSpawnHandler,
  handleChannelManagementCommand,
  setChannelSubagentSpawnHandler,
} from "../../src/core/channels/commands";
import { tables } from "../../src/core/database";
import {
  handleSessionsSpawn,
  resetSubagentSessionsForTests,
} from "../../src/core/tools/handlers/channel";
import { resetSubagentRegistryForTests } from "../../src/core/subagent-registry";

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const createdAgents: string[] = [];
const createdProviders: string[] = [];

function createProvider(name: string): string {
  const providerId = id("provider");
  tables.providers.create({
    id: providerId,
    provider: "openai",
    name,
    base_url: "https://api.openai.com/v1",
    api_key: "test-key",
    is_default: false,
  });
  createdProviders.push(providerId);
  return providerId;
}

function createAgent(name: string, providerId: string, model: string): string {
  const agentId = id("agent");
  tables.agents.create({
    id: agentId,
    name,
    type: "main",
    model,
    provider_id: providerId,
    status: "stopped",
    memory_enabled: false,
  });
  createdAgents.push(agentId);
  return agentId;
}

function addProviderModel(providerId: string, modelId: string): void {
  tables.providerModels.upsert({
    id: id("provider-model"),
    provider_id: providerId,
    model_id: modelId,
    model_name: modelId,
  });
}

afterEach(() => {
  config.set("default_agent_id", "");
  config.set("tool_approval_mode", "always_allow");
  clearChannelSubagentSpawnHandler();
  resetSubagentSessionsForTests();
  resetSubagentRegistryForTests();
  for (const agentId of createdAgents.splice(0)) {
    tables.agents.delete(agentId);
  }
  for (const providerId of createdProviders.splice(0)) {
    tables.providers.delete(providerId);
  }
});

beforeEach(() => {
  setChannelSubagentSpawnHandler(handleSessionsSpawn);
});

describe("channel management commands", () => {
  test("supports ! prefix aliases for command routing", async () => {
    const response = await handleChannelManagementCommand("!status", {
      channelId: "channel-bang",
      chatId: "chat-bang",
      platform: "discord",
    });

    expect(response).toContain("Status:");
  });

  test("switches default agent and rotates session", async () => {
    const providerId = createProvider("Command Provider");
    createAgent("Worker One", providerId, "model-a");
    const targetAgentId = createAgent("Worker Two", providerId, "model-b");

    let sessionId = "session-initial";

    const response = await handleChannelManagementCommand("/agent Worker Two", {
      channelId: "channel-1",
      chatId: "chat-1",
      platform: "discord",
      createSessionId: () => "session-rotated",
      setSessionId: (nextSessionId: string) => {
        sessionId = nextSessionId;
      },
    });

    expect(response).toContain("Worker Two");
    expect(config.get<string>("default_agent_id")).toBe(targetAgentId);
    expect(sessionId).toBe("session-rotated");
  });

  test("updates model for default agent using provider model index", async () => {
    const providerId = createProvider("Model Provider");
    addProviderModel(providerId, "model-one");
    addProviderModel(providerId, "model-two");
    const agentId = createAgent("Model Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    let sessionId = "session-start";
    const response = await handleChannelManagementCommand("/model 2", {
      channelId: "channel-2",
      chatId: "chat-2",
      platform: "slack",
      createSessionId: () => "session-model-2",
      setSessionId: (nextSessionId: string) => {
        sessionId = nextSessionId;
      },
    });

    const updatedAgent = tables.agents.get(agentId) as { model?: string } | undefined;
    expect(response).toContain("model-two");
    expect(updatedAgent?.model).toBe("model-two");
    expect(sessionId).toBe("session-model-2");
  });

  test("parses Telegram-style @bot command suffix when setting model", async () => {
    const providerId = createProvider("Mention Provider");
    addProviderModel(providerId, "mention-model-one");
    addProviderModel(providerId, "mention-model-two");
    const agentId = createAgent("Mention Agent", providerId, "mention-model-one");
    config.set("default_agent_id", agentId);

    const response = await handleChannelManagementCommand("/model@cybara_bot 2", {
      channelId: "channel-mention",
      chatId: "chat-mention",
      platform: "telegram",
      createSessionId: () => "session-mention-2",
      setSessionId: () => {},
    });

    const updatedAgent = tables.agents.get(agentId) as { model?: string } | undefined;
    expect(response).toContain("mention-model-two");
    expect(updatedAgent?.model).toBe("mention-model-two");
  });

  test("switches provider and applies fallback model from target provider", async () => {
    const providerA = createProvider("Provider A");
    addProviderModel(providerA, "a-model");
    const providerB = createProvider("Provider B");
    addProviderModel(providerB, "b-model");

    const agentId = createAgent("Provider Agent", providerA, "a-model");
    config.set("default_agent_id", agentId);

    const response = await handleChannelManagementCommand(`/provider ${providerB}`, {
      channelId: "channel-3",
      chatId: "chat-3",
      platform: "telegram",
      createSessionId: () => "session-provider-b",
      setSessionId: () => {},
    });

    const updatedAgent = tables.agents.get(agentId) as
      | { provider_id?: string; model?: string }
      | undefined;

    expect(response).toContain("Provider B");
    expect(updatedAgent?.provider_id).toBe(providerB);
    expect(updatedAgent?.model).toBe("b-model");
  });

  test("spawns subagents from command surface with session context", async () => {
    const response = await handleChannelManagementCommand(
      "/subagents spawn summarize recent logs",
      {
        channelId: "channel-4",
        chatId: "chat-4",
        platform: "discord",
        sessionId: "session-command-subagent",
        createSessionId: () => "session-command-subagent-rotated",
        setSessionId: () => {},
      }
    );

    expect(response).toContain("Subagent spawned successfully.");
    expect(response).toContain("Run ID:");
    expect(response).toContain("Session:");
    expect(response).toContain("summarize recent logs");
  });

  test("supports singular /subagent alias for spawning", async () => {
    const spawnArgs: Array<Record<string, unknown>> = [];
    setChannelSubagentSpawnHandler(async (args) => {
      spawnArgs.push(args);
      return {
        status: "accepted",
        childSessionKey: "agent:default:subagent:alias",
        runId: "run-subagent-alias",
        task: String(args.task || ""),
      };
    });

    const response = await handleChannelManagementCommand("/subagent spawn summarize alias path", {
      channelId: "channel-subagent-alias",
      chatId: "chat-subagent-alias",
      platform: "slack",
      sessionId: "session-subagent-alias",
    });

    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]?._requesterSessionKey).toBe("session-subagent-alias");
    expect(response).toContain("Subagent spawned successfully.");
    expect(response).toContain("run-subagent-alias");
  });

  test("shows and updates tool permission mode via /permissions command", async () => {
    config.set("tool_approval_mode", "always_allow");

    const before = await handleChannelManagementCommand("/permissions", {
      channelId: "channel-permissions",
      chatId: "chat-permissions",
      platform: "discord",
    });
    expect(before).toContain("Tool permission mode:");
    expect(before).toContain("allow");

    const askResult = await handleChannelManagementCommand("/permissions ask", {
      channelId: "channel-permissions",
      chatId: "chat-permissions",
      platform: "discord",
    });
    expect(askResult).toContain("set to ask");
    expect(config.get<string>("tool_approval_mode")).toBe("ask");

    const allowResult = await handleChannelManagementCommand("/permissions allow", {
      channelId: "channel-permissions",
      chatId: "chat-permissions",
      platform: "discord",
    });
    expect(allowResult).toContain("set to allow");
    expect(config.get<string>("tool_approval_mode")).toBe("always_allow");
  });
});
