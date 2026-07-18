import { afterEach, describe, expect, test } from "bun:test";
import {
  deleteSession,
  getSessionMessages,
  handleChat,
  listPendingChatMessages,
} from "../../src/api/chat";
import { hasPendingChatMessages } from "../../src/api/chat-pending-state";
import { loadPersistedPendingChatItems } from "../../src/api/chat-pending-store";
import { pendingChatQueues, type PendingChatItem } from "../../src/api/chat-runtime-state";
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
