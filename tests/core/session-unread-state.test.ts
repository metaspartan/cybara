import { afterEach, describe, expect, test } from "bun:test";
import { deleteSession, listSessions, markSessionRead } from "../../src/api/chat";
import { persistSession, upsertPersistedSessionMessage } from "../../src/core/session-context";

const createdSessionIds: string[] = [];

function sessionId(): string {
  return `test-unread-${Date.now()}-${crypto.randomUUID()}`;
}

async function unreadState(id: string): Promise<boolean | undefined> {
  return (await listSessions()).find((session) => session.id === id)?.unread;
}

afterEach(async () => {
  for (const id of createdSessionIds.splice(0)) await deleteSession(id);
});

describe("session unread state", () => {
  test("tracks assistant responses after the durable read cursor", async () => {
    const id = sessionId();
    createdSessionIds.push(id);
    await persistSession(id, "test-agent", []);

    expect(await unreadState(id)).toBe(false);

    await upsertPersistedSessionMessage(id, "test-agent", {
      role: "assistant",
      content: "First response",
      timestamp: "2099-01-01T00:00:01.000Z",
    });
    expect(await unreadState(id)).toBe(true);

    expect(markSessionRead(id)).toEqual({ found: true, unread: false });
    expect(await unreadState(id)).toBe(false);

    await upsertPersistedSessionMessage(id, "test-agent", {
      role: "user",
      content: "Follow-up",
      timestamp: "2099-01-01T00:00:02.000Z",
    });
    expect(await unreadState(id)).toBe(false);

    await upsertPersistedSessionMessage(id, "test-agent", {
      role: "assistant",
      content: "Second response",
      timestamp: "2099-01-01T00:00:03.000Z",
    });
    expect(await unreadState(id)).toBe(true);
  });

  test("does not acknowledge unknown sessions", () => {
    expect(markSessionRead("missing-session")).toEqual({ found: false, unread: false });
    expect(markSessionRead(" ")).toEqual({ found: false, unread: false });
  });
});
