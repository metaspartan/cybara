import { afterEach, describe, expect, test } from "bun:test";
import {
  deleteSession,
  getSessionMessages,
  handleChat,
  listPendingChatMessages,
  restorePersistedPendingChatQueues,
} from "../../src/api/chat";
import { settlePendingChatFailure } from "../../src/api/chat-pending-failure";
import { hasPendingChatMessages, preparePendingMessage } from "../../src/api/chat-pending-state";
import {
  loadPersistedPendingChatItems,
  persistPendingChatItem,
} from "../../src/api/chat-pending-store";
import {
  cacheChatSession,
  pendingChatQueues,
  type PendingChatItem,
} from "../../src/api/chat-runtime-state";
import { agentManager } from "../../src/core/agent";
import db from "../../src/core/database";
import { providerManager } from "../../src/core/providers";
import { broadcastStatus } from "../../src/core/status";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const createdTriggers: string[] = [];
const originalFetch = globalThis.fetch;

async function waitForVisibleMessages(sessionId: string, expectedCount: number) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const messages = (await getSessionMessages(sessionId)).filter(
      (message) => message.role !== "system"
    );
    if (messages.length >= expectedCount) return messages;
    await Bun.sleep(10);
  }
  return (await getSessionMessages(sessionId)).filter((message) => message.role !== "system");
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const trigger of createdTriggers.splice(0)) {
    db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
  }
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("pending chat durability", () => {
  test("does not propagate a future restored timestamp into a queued message", () => {
    const now = Date.now();
    const sessionId = `pending-future-${crypto.randomUUID()}`;
    const session = {
      id: sessionId,
      agentId: "pending-agent",
      title: null,
      messages: [
        {
          role: "assistant" as const,
          content: "Old corrupted timestamp",
          timestamp: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
        },
      ],
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      persisted: true,
    };
    const item: PendingChatItem = {
      id: `pending_${crypto.randomUUID()}`,
      sessionId,
      request: { message: "continue", sessionId },
      content: "continue",
      createdAt: now,
      updatedAt: now,
      mode: "queued",
      sequence: 1,
      materialized: false,
    };

    const message = preparePendingMessage(session, item);
    expect(Date.parse(message.timestamp || "")).toBeLessThanOrEqual(Date.now() + 10);
  });

  test("materialized queue entries do not count as visible pending work", () => {
    const sessionId = `materialized-pending-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const now = Date.now();
    const item: PendingChatItem = {
      id: `pending_${crypto.randomUUID()}`,
      sessionId,
      request: { message: "already materialized", sessionId },
      content: "already materialized",
      createdAt: now,
      updatedAt: now,
      mode: "queued",
      sequence: 1,
      materialized: true,
    };
    pendingChatQueues.set(sessionId, [item]);

    expect(hasPendingChatMessages(sessionId)).toBe(false);
    expect(listPendingChatMessages(sessionId)).toEqual([]);
  });

  test("restored materialized turns with assistant responses are not replayed", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Pending Replay Provider",
      api_key: "sk-pending-replay",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Pending Replay Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-pending-replay",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    const sessionId = `pending-replay-${crypto.randomUUID()}`;
    const pendingId = `pending_${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const createdAt = Date.now();
    cacheChatSession({
      id: sessionId,
      agentId: agent.id,
      useModelRouter: false,
      title: null,
      messages: [
        {
          role: "user",
          content: "queued once",
          timestamp: new Date(createdAt).toISOString(),
          pending_chat_id: pendingId,
        },
        {
          role: "assistant",
          content: "completed once",
          timestamp: new Date(createdAt + 1).toISOString(),
        },
      ],
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(createdAt + 1).toISOString(),
      persisted: true,
    });
    const item: PendingChatItem = {
      id: pendingId,
      sessionId,
      request: {
        message: "queued once",
        sessionId,
        agentId: agent.id,
        tools: false,
      },
      content: "queued once",
      createdAt,
      updatedAt: createdAt,
      mode: "queued",
      sequence: 1,
      materialized: true,
    };
    persistPendingChatItem(item);
    pendingChatQueues.delete(sessionId);
    let providerCalls = 0;
    globalThis.fetch = (async () => {
      providerCalls += 1;
      return Response.json({});
    }) as typeof fetch;

    restorePersistedPendingChatQueues();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (loadPersistedPendingChatItems(sessionId).length === 0) break;
      await Bun.sleep(10);
    }
    await Bun.sleep(25);

    expect(providerCalls).toBe(0);
    expect(pendingChatQueues.has(sessionId)).toBe(false);
    expect(loadPersistedPendingChatItems(sessionId)).toEqual([]);
  });

  test("failed queued turns persist an assistant outcome before leaving the queue", async () => {
    const sessionId = `pending-failure-${crypto.randomUUID()}`;
    const pendingId = `pending_${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const createdAt = Date.now();
    const session = {
      id: sessionId,
      agentId: "pending-failure-agent",
      useModelRouter: false,
      title: null,
      messages: [
        {
          role: "user" as const,
          content: "queued turn",
          timestamp: new Date(createdAt).toISOString(),
          pending_chat_id: pendingId,
        },
      ],
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(createdAt).toISOString(),
      persisted: true,
    };
    cacheChatSession(session);
    const item: PendingChatItem = {
      id: pendingId,
      sessionId,
      request: { message: "queued turn", sessionId },
      content: "queued turn",
      createdAt,
      updatedAt: createdAt,
      mode: "queued",
      sequence: 1,
      materialized: true,
    };
    pendingChatQueues.set(sessionId, [item]);
    persistPendingChatItem(item);

    const cleanupError = await settlePendingChatFailure(
      session,
      item,
      new Error("forced queued turn failure")
    );

    expect(cleanupError).toBeUndefined();
    expect(session.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(session.messages.at(-1)?.content).toContain("forced queued turn failure");
    expect(listPendingChatMessages(sessionId)).toEqual([]);
    expect(loadPersistedPendingChatItems(sessionId)).toEqual([]);
    expect(
      (await getSessionMessages(sessionId)).some(
        (message) =>
          message.role === "assistant" && message.content.includes("forced queued turn failure")
      )
    ).toBe(true);
  });

  test("failed outcome persistence keeps the queued turn recoverable", async () => {
    const sessionId = `pending-failure-storage-${crypto.randomUUID()}`;
    const pendingId = `pending_${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const createdAt = Date.now();
    const session = {
      id: sessionId,
      agentId: "pending-failure-storage-agent",
      useModelRouter: false,
      title: null,
      messages: [
        {
          role: "user" as const,
          content: "queued turn",
          timestamp: new Date(createdAt).toISOString(),
          pending_chat_id: pendingId,
        },
      ],
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(createdAt).toISOString(),
      persisted: true,
    };
    cacheChatSession(session);
    const item: PendingChatItem = {
      id: pendingId,
      sessionId,
      request: { message: "queued turn", sessionId },
      content: "queued turn",
      createdAt,
      updatedAt: createdAt,
      mode: "queued",
      sequence: 1,
      materialized: true,
    };
    pendingChatQueues.set(sessionId, [item]);
    persistPendingChatItem(item);
    const trigger = `fail_pending_outcome_${crypto.randomUUID().replaceAll("-", "")}`;
    createdTriggers.push(trigger);
    db.exec(`
      CREATE TRIGGER ${trigger}
      BEFORE INSERT ON session_messages
      WHEN NEW.session_id = '${sessionId}' AND NEW.role = 'assistant'
      BEGIN
        SELECT RAISE(FAIL, 'forced pending outcome failure');
      END
    `);

    await expect(
      settlePendingChatFailure(session, item, new Error("forced queued turn failure"))
    ).rejects.toThrow("forced pending outcome failure");

    expect(session.messages.map((message) => message.role)).toEqual(["user"]);
    expect(pendingChatQueues.get(sessionId)).toHaveLength(1);
    expect(loadPersistedPendingChatItems(sessionId)).toHaveLength(1);
  });

  test("a failed session snapshot does not replay a durably materialized queued turn", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Pending Snapshot Provider",
      api_key: "sk-pending-snapshot",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Pending Snapshot Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-pending-snapshot",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    const sessionId = `pending-snapshot-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      return Response.json({
        id: `pending-snapshot-response-${call}`,
        object: "chat.completion",
        model: "gpt-pending-snapshot",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: `reply-${call}` },
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      });
    }) as typeof fetch;

    await handleChat({
      message: "first",
      agentId: agent.id,
      sessionId,
      tools: false,
    });

    const trigger = `fail_pending_snapshot_${crypto.randomUUID().replaceAll("-", "")}`;
    createdTriggers.push(trigger);
    db.exec(`
      CREATE TRIGGER ${trigger}
      BEFORE UPDATE ON chat_sessions
      WHEN NEW.id = '${sessionId}'
      BEGIN
        SELECT RAISE(FAIL, 'forced pending snapshot failure');
      END
    `);

    broadcastStatus({
      status: "thinking",
      timestamp: Date.now(),
      sessionId,
      agentId: agent.id,
      detail: "active",
    });
    const queued = await handleChat({
      message: "second",
      agentId: agent.id,
      sessionId,
      tools: false,
      queueMode: "queue",
    });
    expect(queued.queued).toBe(true);

    broadcastStatus({
      status: "idle",
      timestamp: Date.now(),
      sessionId,
      agentId: agent.id,
      detail: "idle",
    });

    const messages = await waitForVisibleMessages(sessionId, 4);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages.filter((message) => message.content === "second")).toHaveLength(1);
    expect(listPendingChatMessages(sessionId)).toEqual([]);
    expect(loadPersistedPendingChatItems(sessionId)).toEqual([]);
  });
});
