import { describe, expect, test } from "bun:test";
import {
  findQueuedAssistantMessage,
  waitForQueuedAssistantMessage,
  type QueuedChatSnapshot,
} from "../../src/cli/commands/chat-queued-response";

interface Message {
  role: string;
  content: string;
  pending_chat_id?: string;
}

describe("queued CLI chat responses", () => {
  test("finds the assistant immediately following the materialized queued user", () => {
    const messages: Message[] = [
      { role: "assistant", content: "first" },
      { role: "user", content: "continue", pending_chat_id: "pending-1" },
      { role: "assistant", content: "follow-up" },
    ];
    expect(findQueuedAssistantMessage(messages, "pending-1")?.content).toBe("follow-up");
    expect(findQueuedAssistantMessage(messages, "missing")).toBeNull();
  });

  test("waits through queue materialization and returns the persisted response", async () => {
    const snapshots: Array<QueuedChatSnapshot<Message>> = [
      { messages: [], pendingIds: ["pending-1"] },
      {
        messages: [{ role: "user", content: "continue", pending_chat_id: "pending-1" }],
        pendingIds: [],
      },
      {
        messages: [
          { role: "user", content: "continue", pending_chat_id: "pending-1" },
          { role: "assistant", content: "done" },
        ],
        pendingIds: [],
      },
    ];
    let index = 0;
    const response = await waitForQueuedAssistantMessage({
      pendingId: "pending-1",
      loadSnapshot: async () => snapshots[Math.min(index++, snapshots.length - 1)] ?? null,
      sleep: async () => {},
    });
    expect(response?.content).toBe("done");
    expect(index).toBe(3);
  });

  test("stops waiting when an unmaterialized queued turn is deleted", async () => {
    const response = await waitForQueuedAssistantMessage<Message>({
      pendingId: "pending-1",
      loadSnapshot: async () => ({ messages: [], pendingIds: [] }),
      sleep: async () => {},
    });
    expect(response).toBeNull();
  });
});
