import { describe, expect, test } from "bun:test";
import {
  loadPersistedSession,
  syncPersistedSessionMessageOrder,
  upsertPersistedSessionMessage,
} from "../../src/core/session-context";
import { appendAssistantMessage } from "../../src/api/chat-pending-state";
import {
  type InMemoryChatSession,
  pendingChatQueues,
  persistChatSessionSnapshot,
  type PendingChatItem,
} from "../../src/api/chat-runtime-state";
import type { ChatMessage } from "../../src/api/chat-types";

function makeSession(id: string): InMemoryChatSession {
  return {
    id,
    agentId: "agent-order",
    useModelRouter: false,
    title: "Ordering fixture",
    messages: [],
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    persisted: true,
  };
}

function steeringItem(sessionId: string, id: string): PendingChatItem {
  return {
    id,
    sessionId,
    request: { message: "actually, do X instead" },
    content: "actually, do X instead",
    createdAt: 1_000,
    updatedAt: 1_000,
    mode: "steering",
    sequence: 1,
    materialized: true,
  };
}

describe("persisted chat message order", () => {
  test("a steering message reinserted after the assistant reply survives a reload in that order", async () => {
    const sessionId = "order-steering-fixture";
    const session = makeSession(sessionId);
    pendingChatQueues.set(sessionId, [steeringItem(sessionId, "steer-1")]);

    const firstQuestion: ChatMessage = {
      role: "user",
      content: "audit the module",
      timestamp: "2026-10-07T00:00:01.000Z",
    };
    session.messages.push(firstQuestion);
    await upsertPersistedSessionMessage(session.id, session.agentId, firstQuestion);
    await persistChatSessionSnapshot(session, firstQuestion);

    const steeringMessage: ChatMessage = {
      role: "user",
      content: "actually, do X instead",
      timestamp: "2026-10-07T00:00:02.000Z",
      _pendingSteeringId: "steer-1",
    };
    session.messages.push(steeringMessage);
    await upsertPersistedSessionMessage(session.id, session.agentId, steeringMessage, {
      stableKey: "steer-1",
    });
    await persistChatSessionSnapshot(session, steeringMessage);

    const reply: ChatMessage = {
      role: "assistant",
      content: "Here is the audit.",
      timestamp: "2026-10-07T00:00:03.000Z",
    };
    appendAssistantMessage(session, reply);
    await upsertPersistedSessionMessage(session.id, session.agentId, reply, {
      stableKey: "reply-1",
    });
    await persistChatSessionSnapshot(session, reply);

    const inMemoryOrder = session.messages.map((message) => message.content);
    expect(inMemoryOrder).toEqual([
      "audit the module",
      "Here is the audit.",
      "actually, do X instead",
    ]);

    const loaded = await loadPersistedSession(sessionId);
    const reloadedOrder = (loaded?.messages ?? []).map((message) => message.content);

    expect(reloadedOrder).toEqual(inMemoryOrder);
    pendingChatQueues.delete(sessionId);
  });

  test("an assistant failure recorded after a queued message keeps its position on reload", async () => {
    const sessionId = "order-queued-failure-fixture";
    const session = makeSession(sessionId);
    pendingChatQueues.delete(sessionId);

    const queued: ChatMessage = {
      role: "user",
      content: "run the second batch",
      timestamp: "2026-10-07T00:01:01.000Z",
    };
    session.messages.push(queued);
    await upsertPersistedSessionMessage(session.id, session.agentId, queued, {
      stableKey: "queued-1",
    });
    await persistChatSessionSnapshot(session, queued);

    const laterReply: ChatMessage = {
      role: "assistant",
      content: "first batch done",
      timestamp: "2026-10-07T00:01:02.000Z",
    };
    session.messages.push(laterReply);
    await upsertPersistedSessionMessage(session.id, session.agentId, laterReply, {
      stableKey: "reply-2",
    });
    await persistChatSessionSnapshot(session, laterReply);

    const failureIndex = session.messages.indexOf(queued);
    const failure: ChatMessage = {
      role: "assistant",
      content: "queued batch failed",
      timestamp: "2026-10-07T00:01:03.000Z",
    };
    session.messages.splice(failureIndex + 1, 0, failure);
    await upsertPersistedSessionMessage(session.id, session.agentId, failure, {
      stableKey: "failure-1",
    });
    await persistChatSessionSnapshot(session, failure);

    const inMemoryOrder = session.messages.map((message) => message.content);
    const loaded = await loadPersistedSession(sessionId);
    const reloadedOrder = (loaded?.messages ?? []).map((message) => message.content);

    expect(reloadedOrder).toEqual(inMemoryOrder);
  });

  test("a long chat with repeated steering keeps every message in place", async () => {
    const sessionId = "order-long-context-fixture";
    const session = makeSession(sessionId);
    pendingChatQueues.delete(sessionId);

    const expected: string[] = [];
    for (let turn = 0; turn < 25; turn += 1) {
      const question: ChatMessage = {
        role: "user",
        content: `question ${turn}`,
        timestamp: new Date(1_780_000_000_000 + turn * 1000).toISOString(),
      };
      session.messages.push(question);
      await upsertPersistedSessionMessage(session.id, session.agentId, question, {
        stableKey: `q-${turn}`,
      });
      await persistChatSessionSnapshot(session, question);
      expected.push(question.content);

      if (turn % 2 === 0) {
        const steeringId = `steer-${turn}`;
        pendingChatQueues.set(sessionId, [steeringItem(sessionId, steeringId)]);
        const steering: ChatMessage = {
          role: "user",
          content: `steer ${turn}`,
          timestamp: new Date(1_780_000_000_500 + turn * 1000).toISOString(),
          _pendingSteeringId: steeringId,
        };
        session.messages.push(steering);
        await upsertPersistedSessionMessage(session.id, session.agentId, steering, {
          stableKey: steeringId,
        });
        await persistChatSessionSnapshot(session, steering);

        const reply: ChatMessage = {
          role: "assistant",
          content: `answer ${turn}`,
          timestamp: new Date(1_780_000_000_750 + turn * 1000).toISOString(),
        };
        appendAssistantMessage(session, reply);
        await upsertPersistedSessionMessage(session.id, session.agentId, reply, {
          stableKey: `a-${turn}`,
        });
        await persistChatSessionSnapshot(session, reply);
        expected.push(reply.content, steering.content);
        continue;
      }

      const reply: ChatMessage = {
        role: "assistant",
        content: `answer ${turn}`,
        timestamp: new Date(1_780_000_000_750 + turn * 1000).toISOString(),
      };
      appendAssistantMessage(session, reply);
      await upsertPersistedSessionMessage(session.id, session.agentId, reply, {
        stableKey: `a-${turn}`,
      });
      await persistChatSessionSnapshot(session, reply);
      expected.push(reply.content);
    }

    const inMemoryOrder = session.messages.map((message) => message.content);
    expect(inMemoryOrder).toEqual(expected);

    const loaded = await loadPersistedSession(sessionId);
    const reloadedOrder = (loaded?.messages ?? []).map((message) => message.content);
    expect(reloadedOrder).toEqual(expected);
    pendingChatQueues.delete(sessionId);
  });

  test("reordering writes only the rows whose position changed", async () => {
    const sessionId = "order-noop-sync-fixture";
    const session = makeSession(sessionId);
    const first: ChatMessage = {
      role: "user",
      content: "first message",
      timestamp: "2026-10-07T00:02:01.000Z",
    };
    const second: ChatMessage = {
      role: "assistant",
      content: "second message",
      timestamp: "2026-10-07T00:02:02.000Z",
    };
    session.messages.push(first, second);
    await upsertPersistedSessionMessage(session.id, session.agentId, first, {
      stableKey: "first",
    });
    await upsertPersistedSessionMessage(session.id, session.agentId, second, {
      stableKey: "second",
    });
    await persistChatSessionSnapshot(session, second);

    expect(syncPersistedSessionMessageOrder(sessionId, session.messages)).toBe(0);
    expect(syncPersistedSessionMessageOrder(sessionId, [...session.messages].reverse())).toBe(2);
    expect(syncPersistedSessionMessageOrder(sessionId, [...session.messages].reverse())).toBe(0);
  });
});
