import { describe, expect, test } from "bun:test";
import { IMessageAdapter, imessageSessions } from "../../src/core/channels/adapters/imessage";
import { securityManager } from "../../src/core/channels/security";

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
});
