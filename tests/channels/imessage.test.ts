import { afterEach, describe, expect, test } from "bun:test";
import { IMessageAdapter, imessageSessions } from "../../src/core/channels/adapters/imessage";
import { securityManager } from "../../src/core/channels/security";
import { config } from "../../src/core/config";
import { tables } from "../../src/core/database";

type BlueBubblesMessage = {
  guid: string;
  text: string;
  chatGuid: string;
  handle?: {
    address: string;
    service: string;
  };
  isFromMe: boolean;
  dateCreated: number;
  attachments?: Array<{
    guid: string;
    mimeType: string;
    transferName: string;
    totalBytes: number;
  }>;
};

function makeChannelId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const createdAgents: string[] = [];
const createdProviders: string[] = [];

function createProvider(name: string): string {
  const providerId = makeChannelId("imsg-provider");
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
  const agentId = makeChannelId("imsg-agent");
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
    id: makeChannelId("imsg-provider-model"),
    provider_id: providerId,
    model_id: modelId,
    model_name: modelId,
  });
}

async function invokeIMessage(
  adapter: IMessageAdapter,
  channelId: string,
  message: BlueBubblesMessage
): Promise<void> {
  await (
    adapter as unknown as {
      handleMessage: (id: string, msg: BlueBubblesMessage) => Promise<void>;
    }
  ).handleMessage(channelId, message);
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

function makeMessage(overrides: Partial<BlueBubblesMessage>): BlueBubblesMessage {
  return {
    guid: `msg-${Date.now()}`,
    text: "hello",
    chatGuid: "chat-1",
    handle: {
      address: "sender@icloud.com",
      service: "iMessage",
    },
    isFromMe: false,
    dateCreated: Date.now(),
    attachments: [],
    ...overrides,
  };
}

describe("iMessage adapter mocked flows", () => {
  test("ignores own messages", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-ignore");
    let handlerCalls = 0;
    let sendCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as { sendBlueBubblesMessage: () => Promise<boolean> }
    ).sendBlueBubblesMessage = async () => {
      sendCalls += 1;
      return true;
    };

    await invokeIMessage(adapter, channelId, makeMessage({ isFromMe: true }));

    expect(handlerCalls).toBe(0);
    expect(sendCalls).toBe(0);
  });

  test("creates pairing for new sender and sends security message", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-pairing");
    const sent: Array<{ chatGuid: string; message: string }> = [];
    let handlerCalls = 0;

    imessageSessions.clear();
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    securityManager.setConfig(channelId, { dm_policy: "pairing", allowed_senders: [] });

    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, chatGuid, message) => {
      sent.push({ chatGuid, message });
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        handle: { address: "new-user@icloud.com", service: "iMessage" },
      })
    );

    expect(handlerCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].chatGuid).toBe("chat-1");
    expect(sent[0].message).toContain("Pairing code");
    expect(securityManager.getPendingPairings(channelId).length).toBe(1);
  });

  test("routes allowed sender messages and reuses session id", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-session");
    const sent: string[] = [];
    const handlerInputs: Array<{
      content: string;
      chatGuid: string;
      sessionId: string;
    }> = [];

    imessageSessions.clear();
    securityManager.setConfig(channelId, { dm_policy: "pairing" });
    securityManager.addAllowedSender(channelId, "allowed@icloud.com");

    adapter.setMessageHandler(async (content, chatGuid, sessionId) => {
      handlerInputs.push({ content, chatGuid, sessionId });
      return `echo:${content}`;
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        guid: "m1",
        text: "first",
        handle: { address: "allowed@icloud.com", service: "iMessage" },
      })
    );
    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        guid: "m2",
        text: "second",
        handle: { address: "allowed@icloud.com", service: "iMessage" },
      })
    );

    expect(handlerInputs).toHaveLength(2);
    expect(handlerInputs[0].content).toBe("first");
    expect(handlerInputs[1].content).toBe("second");
    expect(handlerInputs[0].chatGuid).toBe("chat-1");
    expect(handlerInputs[1].chatGuid).toBe("chat-1");
    expect(handlerInputs[0].sessionId).toBe(handlerInputs[1].sessionId);
    expect(sent).toEqual(["echo:first", "echo:second"]);
  });

  test("attachment-only message forwards placeholder and file metadata", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-attachment");
    const handlerInputs: Array<{
      content: string;
      fileInfo: { hasFile: boolean; fileType: string; placeholder: string };
    }> = [];
    const sent: string[] = [];

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async (content, _chatGuid, _sessionId, fileInfo) => {
      handlerInputs.push({
        content,
        fileInfo: {
          hasFile: fileInfo.hasFile,
          fileType: fileInfo.fileType,
          placeholder: fileInfo.placeholder,
        },
      });
      return "attachment-ok";
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        text: "",
        attachments: [
          {
            guid: "att-1",
            mimeType: "image/jpeg",
            transferName: "photo.jpg",
            totalBytes: 1234,
          },
        ],
      })
    );

    expect(handlerInputs).toHaveLength(1);
    expect(handlerInputs[0].content).toBe("<attachment:photo.jpg>");
    expect(handlerInputs[0].fileInfo.hasFile).toBe(true);
    expect(handlerInputs[0].fileInfo.fileType).toBe("image/jpeg");
    expect(handlerInputs[0].fileInfo.placeholder).toBe("<attachment:photo.jpg>");
    expect(sent).toEqual(["attachment-ok"]);
  });

  test("sends fallback error response when handler throws", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-error");
    const sent: string[] = [];

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      throw new Error("handler exploded");
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(adapter, channelId, makeMessage({ text: "hello" }));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("encountered an error");
  });

  test("handles slash management commands without invoking chat handler", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        text: "/help",
        handle: { address: "allowed@icloud.com", service: "iMessage" },
      })
    );

    expect(handlerCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Available management commands");
  });

  test("routes /status command and avoids chat handler", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-status-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        text: "/status",
        handle: { address: "allowed@icloud.com", service: "iMessage" },
      })
    );

    expect(handlerCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Status:");
    expect(sent[0]).toContain("Agents:");
  });

  test("routes /agents command and avoids chat handler", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-agents-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("iMessage Agents Provider");
    createAgent("iMessage Agents Target", providerId, "model-one");

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        text: "/agents",
        handle: { address: "allowed@icloud.com", service: "iMessage" },
      })
    );

    expect(handlerCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Agents:");
    expect(sent[0]).toContain("iMessage Agents Target");
  });

  test("routes /providers command and avoids chat handler", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-providers-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("iMessage Providers Target");
    const agentId = createAgent("iMessage Providers Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        text: "/providers",
        handle: { address: "allowed@icloud.com", service: "iMessage" },
      })
    );

    expect(handlerCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Providers");
    expect(sent[0]).toContain("iMessage Providers Target");
  });

  test("routes /new command and rotates iMessage session id", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-new-command");
    const chatGuid = "chat-new";
    const initialSessionId = "session-imsg-initial";
    const sent: string[] = [];
    let handlerCalls = 0;

    imessageSessions.set(chatGuid, initialSessionId);
    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        chatGuid,
        text: "/new",
        handle: { address: "allowed@icloud.com", service: "iMessage" },
      })
    );

    const rotatedSessionId = imessageSessions.get(chatGuid);
    expect(handlerCalls).toBe(0);
    expect(rotatedSessionId).toBeDefined();
    expect(rotatedSessionId).not.toBe(initialSessionId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Started a new session");
  });

  test("routes /model command and updates default agent model", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-model-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("iMessage Model Provider");
    addProviderModel(providerId, "model-one");
    addProviderModel(providerId, "model-two");
    const agentId = createAgent("iMessage Model Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        text: "/model 2",
        handle: { address: "allowed@icloud.com", service: "iMessage" },
      })
    );

    const updatedAgent = tables.agents.get(agentId) as { model?: string } | undefined;
    expect(handlerCalls).toBe(0);
    expect(updatedAgent?.model).toBe("model-two");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("model-two");
  });

  test("routes /agent command and updates default agent selection", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-agent-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("iMessage Agent Provider");
    const firstAgentId = createAgent("iMessage Agent One", providerId, "model-one");
    const secondAgentId = createAgent("iMessage Agent Two", providerId, "model-two");
    config.set("default_agent_id", firstAgentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        text: `/agent ${secondAgentId}`,
        handle: { address: "allowed@icloud.com", service: "iMessage" },
      })
    );

    expect(handlerCalls).toBe(0);
    expect(config.get<string>("default_agent_id")).toBe(secondAgentId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("iMessage Agent Two");
  });

  test("routes /provider command and updates default agent provider/model", async () => {
    const adapter = new IMessageAdapter();
    const channelId = makeChannelId("imsg-provider-command");
    const sent: string[] = [];
    let handlerCalls = 0;

    const providerA = createProvider("iMessage Provider A");
    addProviderModel(providerA, "a-model");
    const providerB = createProvider("iMessage Provider B");
    addProviderModel(providerB, "b-model");
    const agentId = createAgent("iMessage Provider Agent", providerA, "a-model");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    (
      adapter as unknown as {
        sendBlueBubblesMessage: (
          _id: string,
          _chatGuid: string,
          message: string
        ) => Promise<boolean>;
      }
    ).sendBlueBubblesMessage = async (_id, _chatGuid, message) => {
      sent.push(message);
      return true;
    };

    await invokeIMessage(
      adapter,
      channelId,
      makeMessage({
        text: `/provider ${providerB}`,
        handle: { address: "allowed@icloud.com", service: "iMessage" },
      })
    );

    const updatedAgent = tables.agents.get(agentId) as
      | { provider_id?: string; model?: string }
      | undefined;
    expect(handlerCalls).toBe(0);
    expect(updatedAgent?.provider_id).toBe(providerB);
    expect(updatedAgent?.model).toBe("b-model");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("iMessage Provider B");
  });
});
