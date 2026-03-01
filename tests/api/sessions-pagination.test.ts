import { afterEach, describe, expect, test } from "bun:test";
import db from "../../src/core/database";
import { listSessions, deleteSession, type ChatMessage } from "../../src/api/chat";
import { persistSession } from "../../src/core/session-context";
import { logSessionMessage } from "../../src/core/logging";

const createdSessionIds: string[] = [];

function makeSessionId(label: string): string {
  return `test-session-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createPersistedSession(params: {
  label: string;
  updatedAt: string;
  userPrompt: string;
  assistantReply: string;
}): Promise<string> {
  const sessionId = makeSessionId(params.label);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "System prompt",
      timestamp: "2099-01-01T00:00:00.000Z",
    },
    {
      role: "user",
      content: params.userPrompt,
      timestamp: "2099-01-01T00:00:01.000Z",
    },
    {
      role: "assistant",
      content: params.assistantReply,
      timestamp: "2099-01-01T00:00:02.000Z",
    },
  ];

  await persistSession(sessionId, "test-agent", messages, null, `Title ${params.label}`);
  for (const message of messages) {
    await logSessionMessage(sessionId, message.role, message.content, {
      agentId: "test-agent",
    });
  }
  db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(params.updatedAt, sessionId);
  createdSessionIds.push(sessionId);
  return sessionId;
}

afterEach(async () => {
  while (createdSessionIds.length > 0) {
    const id = createdSessionIds.pop();
    if (!id) continue;
    await deleteSession(id);
  }
});

describe("session listing pagination", () => {
  test("returns deterministic pages with limit and offset", async () => {
    const oldest = await createPersistedSession({
      label: "oldest",
      updatedAt: "2099-01-01T00:00:10.000Z",
      userPrompt: "old prompt",
      assistantReply: "old reply",
    });
    const middle = await createPersistedSession({
      label: "middle",
      updatedAt: "2099-01-01T00:00:20.000Z",
      userPrompt: "mid prompt",
      assistantReply: "mid reply",
    });
    const newest = await createPersistedSession({
      label: "newest",
      updatedAt: "2099-01-01T00:00:30.000Z",
      userPrompt: "new prompt",
      assistantReply: "new reply",
    });

    const firstPage = await listSessions({ limit: 2, offset: 0 });
    const secondPage = await listSessions({ limit: 2, offset: 2 });

    const firstPageIds = firstPage.slice(0, 2).map((session) => session.id);
    const secondPageFirstId = secondPage[0]?.id;

    expect(firstPageIds).toEqual([newest, middle]);
    expect(secondPageFirstId).toBe(oldest);

    const newestSession = firstPage.find((session) => session.id === newest);
    expect(newestSession?.messageCount).toBe(3);
    expect(newestSession?.lastMessage?.content).toContain("new reply");
  });
});
