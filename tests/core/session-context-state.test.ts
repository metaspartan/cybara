import { afterEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../src/api/chat";
import db, { tables } from "../../src/core/database";
import {
  clearSessionContextState,
  deletePersistedSession,
  listPersistedSessions,
  loadPersistedSession,
  loadPersistedSessionMessage,
  persistSession,
  persistSessionContextState,
  upsertPersistedSessionMessage,
} from "../../src/core/session-context";
import {
  appendSessionEvent,
  ensureSessionRunId,
  listSessionEvents,
} from "../../src/core/session-event-ledger";

const sessionIds: string[] = [];

afterEach(async () => {
  for (const sessionId of sessionIds.splice(0)) await deletePersistedSession(sessionId);
});

describe("persisted active session context", () => {
  test("restores the authoritative worked duration", async () => {
    const sessionId = `context-duration-${crypto.randomUUID()}`;
    sessionIds.push(sessionId);
    const message: ChatMessage = {
      role: "assistant",
      content: "Done",
      worked_duration_ms: 26_000,
    };

    await upsertPersistedSessionMessage(sessionId, "context-agent", message, {
      stableKey: "duration-assistant",
    });

    expect((await loadPersistedSession(sessionId))?.messages[0]?.worked_duration_ms).toBe(26_000);
  });

  test("deleting a persisted session clears its event ledger", async () => {
    const sessionId = `context-ledger-delete-${crypto.randomUUID()}`;
    expect(await persistSession(sessionId, "context-agent", [])).toBe(true);
    const runId = ensureSessionRunId(sessionId);
    appendSessionEvent({ sessionId, runId, type: "run_started", payload: {} });
    expect(listSessionEvents(sessionId)).toHaveLength(1);

    expect(await deletePersistedSession(sessionId)).toBe(true);
    expect(listSessionEvents(sessionId)).toEqual([]);
  });

  test("restores compacted model context without replacing the canonical transcript", async () => {
    const sessionId = `context-state-${crypto.randomUUID()}`;
    sessionIds.push(sessionId);
    const userMessage: ChatMessage = { role: "user", content: "Original question" };
    const assistantMessage: ChatMessage = { role: "assistant", content: "Original answer" };
    const canonical = [userMessage, assistantMessage];
    expect(await persistSession(sessionId, "context-agent", canonical, null, "Context test")).toBe(
      true
    );
    await upsertPersistedSessionMessage(sessionId, "context-agent", userMessage, {
      stableKey: "context-user",
    });
    await upsertPersistedSessionMessage(sessionId, "context-agent", assistantMessage, {
      stableKey: "context-assistant",
    });

    const activeContext: ChatMessage[] = [
      { role: "system", content: "Summary of the original exchange" },
      assistantMessage,
    ];
    expect(persistSessionContextState(sessionId, activeContext, 2)).toBe(true);

    const restored = await loadPersistedSession(sessionId);
    expect(restored?.messages.map((message) => message.content)).toEqual([
      "Original question",
      "Original answer",
    ]);
    expect(restored?.contextMessages?.map((message) => message.content)).toEqual([
      "Summary of the original exchange",
      "Original answer",
    ]);
    expect(restored?.compactionCount).toBe(2);
  });

  test("chat session upserts preserve compacted context state", async () => {
    const sessionId = `context-upsert-${crypto.randomUUID()}`;
    sessionIds.push(sessionId);
    const userMessage: ChatMessage = { role: "user", content: "Keep compacted state" };
    const messages = [userMessage];
    expect(await persistSession(sessionId, "context-agent", messages, null, "Before upsert")).toBe(
      true
    );
    await upsertPersistedSessionMessage(sessionId, "context-agent", userMessage, {
      stableKey: "context-upsert-user",
    });
    expect(persistSessionContextState(sessionId, messages, 1)).toBe(true);

    tables.chatSessions.upsert({
      id: sessionId,
      agent_id: "context-agent",
      title: "After upsert",
      messages: JSON.stringify(messages),
      workspace_dir: null,
      created_at: new Date().toISOString(),
    });

    expect((await loadPersistedSession(sessionId))?.compactionCount).toBe(1);
    expect(clearSessionContextState(sessionId)).toBe(true);
    expect((await loadPersistedSession(sessionId))?.contextMessages).toBeNull();
  });

  test("stable retries preserve transcript append order and the final assistant", async () => {
    const sessionId = `context-stable-order-${crypto.randomUUID()}`;
    sessionIds.push(sessionId);
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: "Start the long task",
        timestamp: "2026-07-15T09:00:00.000Z",
      },
      {
        role: "assistant",
        content: "",
        timestamp: "2026-07-15T09:00:05.000Z",
        process_activities: [
          {
            id: "steered-boundary",
            phase: "result",
            text: "Conversation steered.",
            timestamp: Date.parse("2026-07-15T09:00:05.000Z"),
            toolName: "__steering",
          },
        ],
      },
      {
        role: "user",
        content: "Change direction",
        timestamp: "2026-07-15T09:00:05.001Z",
      },
      {
        role: "assistant",
        content: "Finished the steered task",
        timestamp: "2026-07-15T09:00:08.000Z",
      },
    ];
    expect(await persistSession(sessionId, "context-agent", messages)).toBe(true);
    await upsertPersistedSessionMessage(sessionId, "context-agent", messages[0]!, {
      stableKey: "initial-user",
    });
    await upsertPersistedSessionMessage(sessionId, "context-agent", messages[1]!, {
      stableKey: "steering-boundary",
    });
    await upsertPersistedSessionMessage(sessionId, "context-agent", messages[2]!, {
      stableKey: "steering-user",
    });
    await upsertPersistedSessionMessage(sessionId, "context-agent", messages[3]!, {
      stableKey: "final-assistant",
    });

    await upsertPersistedSessionMessage(
      sessionId,
      "context-agent",
      { ...messages[1]!, timestamp: "2026-07-15T15:00:00.000Z" },
      { stableKey: "steering-boundary" }
    );
    await upsertPersistedSessionMessage(
      sessionId,
      "context-agent",
      { ...messages[2]!, timestamp: "2026-07-15T15:00:00.001Z" },
      { stableKey: "steering-user" }
    );

    const restored = await loadPersistedSession(sessionId);
    expect(restored?.messages.map((message) => message.content)).toEqual([
      "Start the long task",
      "",
      "Change direction",
      "Finished the steered task",
    ]);
    expect(restored?.messages[1]?.timestamp).toBe("2026-07-15T09:00:05.000Z");
    expect(restored?.messages.at(-1)?.content).toBe("Finished the steered task");
    const summary = (await listPersistedSessions()).find((session) => session.id === sessionId);
    expect(summary?.lastMessageRole).toBe("assistant");
    expect(summary?.lastMessageContent).toBe("Finished the steered task");
  });

  test("defers heavy historical metadata while retaining full message text and lazy detail", async () => {
    const sessionId = `context-deferred-metadata-${crypto.randomUUID()}`;
    sessionIds.push(sessionId);
    for (let index = 0; index < 61; index += 1) {
      await upsertPersistedSessionMessage(
        sessionId,
        "context-agent",
        {
          role: "assistant",
          content: `Complete response ${index}`,
          thinking: `Reasoning ${index}`,
          process_activities: [
            {
              id: `activity-${index}`,
              phase: "result",
              text: `Finished work ${index}`,
              timestamp: index,
              toolName: "read",
            },
          ],
        },
        { stableKey: `deferred-message-${index}` }
      );
    }
    db.prepare(
      "UPDATE session_messages SET metadata = '{malformed' WHERE session_id = ? AND content = ?"
    ).run(sessionId, "Complete response 1");

    const compact = await loadPersistedSession(sessionId, {
      deferHistoricalMetadata: true,
    });
    const first = compact?.messages[0];
    expect(compact?.messages).toHaveLength(61);
    expect(first).toMatchObject({
      content: "Complete response 0",
      metadata_deferred: true,
    });
    expect(first?.thinking).toBeUndefined();
    expect(first?.process_activities).toBeUndefined();
    expect(compact?.messages[1]).toMatchObject({
      content: "Complete response 1",
      metadata_deferred: true,
    });
    expect(compact?.messages[52]?.metadata_deferred).toBe(true);
    expect(compact?.messages[53]?.thinking).toBe("Reasoning 53");

    const hydrated = await loadPersistedSessionMessage(sessionId, first?.message_id || "");
    expect(hydrated).toMatchObject({
      content: "Complete response 0",
      thinking: "Reasoning 0",
      process_activities: [
        {
          id: "activity-0",
          text: "Finished work 0",
        },
      ],
    });
    expect(hydrated?.metadata_deferred).toBeUndefined();
  });
});
