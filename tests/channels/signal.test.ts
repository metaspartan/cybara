import { afterEach, describe, expect, test } from "bun:test";
import { SignalAdapter, signalSessions } from "../../src/core/channels/adapters/signal";
import { securityManager } from "../../src/core/channels/security";
import { config } from "../../src/core/config";
import { tables } from "../../src/core/database";

type SignalEnvelope = {
  sourceNumber?: string;
  sourceUuid?: string;
  sourceName?: string;
  timestamp?: number;
  dataMessage?: {
    message?: string;
    timestamp?: number;
    attachments?: Array<{ contentType: string; filename?: string }>;
  };
};

function makeChannelId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const createdAgents: string[] = [];
const createdProviders: string[] = [];

function createProvider(name: string): string {
  const providerId = makeChannelId("signal-provider");
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
  const agentId = makeChannelId("signal-agent");
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
    id: makeChannelId("signal-provider-model"),
    provider_id: providerId,
    model_id: modelId,
    model_name: modelId,
  });
}

async function invokeSignalEnvelope(
  adapter: SignalAdapter,
  channelId: string,
  envelope: SignalEnvelope
): Promise<void> {
  await (
    adapter as unknown as {
      handleEnvelope: (id: string, env: SignalEnvelope) => Promise<void>;
    }
  ).handleEnvelope(channelId, envelope);
}

afterEach(() => {
  config.set("default_agent_id", "");
  for (const agentId of createdAgents.splice(0)) {
    tables.agents.delete(agentId);
  }
  for (const providerId of createdProviders.splice(0)) {
    tables.providers.delete(providerId);
  }
});

describe("Signal adapter mocked flows", () => {
  test("ignores envelopes without text message", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-ignore");
    let handlerCalls = 0;
    let sendCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (adapter as unknown as { sendSignalMessage: () => Promise<boolean> }).sendSignalMessage =
      async () => {
        sendCalls += 1;
        return true;
      };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550001111",
      dataMessage: {},
    });

    expect(handlerCalls).toBe(0);
    expect(sendCalls).toBe(0);
  });

  test("creates pairing for new sender and sends security message", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-pairing");
    const sent: Array<{ recipient: string; message: string }> = [];
    let handlerCalls = 0;

    signalSessions.clear();
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    securityManager.setConfig(channelId, { dm_policy: "pairing", allowed_senders: [] });

    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, recipient, message) => {
      sent.push({ recipient, message });
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550002222",
      sourceName: "Alice",
      dataMessage: { message: "hello" },
    });

    expect(handlerCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].recipient).toBe("+15550002222");
    expect(sent[0].message).toContain("Pairing code");
    expect(securityManager.getPendingPairings(channelId).length).toBe(1);
  });

  test("routes allowed sender messages and reuses session id", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-session");
    const sent: string[] = [];
    const handlerInputs: Array<{ message: string; sender: string; sessionId: string }> = [];

    signalSessions.clear();
    securityManager.setConfig(channelId, { dm_policy: "pairing" });
    securityManager.addAllowedSender(channelId, "+15550003333");

    adapter.setMessageHandler(async (message, sender, sessionId) => {
      handlerInputs.push({ message, sender, sessionId });
      return `echo:${message}`;
    });
    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, _recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, _recipient, message) => {
      sent.push(message);
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550003333",
      dataMessage: { message: "first" },
    });
    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550003333",
      dataMessage: { message: "second" },
    });

    expect(handlerInputs).toHaveLength(2);
    expect(handlerInputs[0].message).toBe("first");
    expect(handlerInputs[1].message).toBe("second");
    expect(handlerInputs[0].sender).toBe("+15550003333");
    expect(handlerInputs[1].sender).toBe("+15550003333");
    expect(handlerInputs[0].sessionId).toBe(handlerInputs[1].sessionId);
    expect(sent).toEqual(["echo:first", "echo:second"]);
  });

  test("sends fallback error message when handler throws", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-error");
    const sent: string[] = [];

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      throw new Error("handler exploded");
    });
    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, _recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, _recipient, message) => {
      sent.push(message);
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550004444",
      dataMessage: { message: "hello" },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("encountered an error");
  });

  test("handles slash management commands without invoking chat handler", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, _recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, _recipient, message) => {
      sent.push(message);
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550005555",
      dataMessage: { message: "/help" },
    });

    expect(handlerCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Available management commands");
  });

  test("routes /status command and avoids chat handler", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-status-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, _recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, _recipient, message) => {
      sent.push(message);
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550005556",
      dataMessage: { message: "/status" },
    });

    expect(handlerCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Status:");
    expect(sent[0]).toContain("Agents:");
  });

  test("routes /agents command and avoids chat handler", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-agents-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Signal Agents Provider");
    createAgent("Signal Agents Target", providerId, "model-one");

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, _recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, _recipient, message) => {
      sent.push(message);
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550005558",
      dataMessage: { message: "/agents" },
    });

    expect(handlerCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Agents:");
    expect(sent[0]).toContain("Signal Agents Target");
  });

  test("routes /providers command and avoids chat handler", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-providers-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Signal Providers Target");
    const agentId = createAgent("Signal Providers Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, _recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, _recipient, message) => {
      sent.push(message);
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550005559",
      dataMessage: { message: "/providers" },
    });

    expect(handlerCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Providers");
    expect(sent[0]).toContain("Signal Providers Target");
  });

  test("routes /new command and rotates signal session id", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-new-command");
    const sender = "+15550005557";
    const initialSessionId = "session-signal-initial";
    const sent: string[] = [];
    let handlerCalls = 0;

    signalSessions.set(sender, initialSessionId);
    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, _recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, _recipient, message) => {
      sent.push(message);
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: sender,
      dataMessage: { message: "/new" },
    });

    const rotatedSessionId = signalSessions.get(sender);
    expect(handlerCalls).toBe(0);
    expect(rotatedSessionId).toBeDefined();
    expect(rotatedSessionId).not.toBe(initialSessionId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Started a new session");
  });

  test("routes /model command and updates default agent model", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-model-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Signal Model Provider");
    addProviderModel(providerId, "model-one");
    addProviderModel(providerId, "model-two");
    const agentId = createAgent("Signal Model Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, _recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, _recipient, message) => {
      sent.push(message);
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550006666",
      dataMessage: { message: "/model 2" },
    });

    const updatedAgent = tables.agents.get(agentId) as { model?: string } | undefined;
    expect(handlerCalls).toBe(0);
    expect(updatedAgent?.model).toBe("model-two");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("model-two");
  });

  test("routes /agent command and updates default agent selection", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-agent-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Signal Agent Provider");
    const firstAgentId = createAgent("Signal Agent One", providerId, "model-one");
    const secondAgentId = createAgent("Signal Agent Two", providerId, "model-two");
    config.set("default_agent_id", firstAgentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, _recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, _recipient, message) => {
      sent.push(message);
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550007777",
      dataMessage: { message: `/agent ${secondAgentId}` },
    });

    expect(handlerCalls).toBe(0);
    expect(config.get<string>("default_agent_id")).toBe(secondAgentId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Signal Agent Two");
  });

  test("routes /provider command and updates default agent provider/model", async () => {
    const adapter = new SignalAdapter();
    const channelId = makeChannelId("signal-provider-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    const providerA = createProvider("Signal Provider A");
    addProviderModel(providerA, "a-model");
    const providerB = createProvider("Signal Provider B");
    addProviderModel(providerB, "b-model");
    const agentId = createAgent("Signal Provider Agent", providerA, "a-model");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendSignalMessage: (_id: string, _recipient: string, message: string) => Promise<boolean>;
      }
    ).sendSignalMessage = async (_id, _recipient, message) => {
      sent.push(message);
      return true;
    };

    await invokeSignalEnvelope(adapter, channelId, {
      sourceNumber: "+15550008888",
      dataMessage: { message: `/provider ${providerB}` },
    });

    const updatedAgent = tables.agents.get(agentId) as
      | { provider_id?: string; model?: string }
      | undefined;
    expect(handlerCalls).toBe(0);
    expect(updatedAgent?.provider_id).toBe(providerB);
    expect(updatedAgent?.model).toBe("b-model");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Signal Provider B");
  });
});
