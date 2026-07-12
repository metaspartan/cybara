import { afterEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../src/api/chat";
import { tables } from "../../src/core/database";
import {
  clearSessionContextState,
  deletePersistedSession,
  loadPersistedSession,
  persistSession,
  persistSessionContextState,
  upsertPersistedSessionMessage,
} from "../../src/core/session-context";

const sessionIds: string[] = [];

afterEach(async () => {
  for (const sessionId of sessionIds.splice(0)) await deletePersistedSession(sessionId);
});

describe("persisted active session context", () => {
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
});
