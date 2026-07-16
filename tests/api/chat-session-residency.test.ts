import { afterEach, describe, expect, test } from "bun:test";
import { deleteSession, getSession } from "../../src/api/chat";
import { persistSession, upsertPersistedSessionMessage } from "../../src/core/session-context";

const sessionIds: string[] = [];

afterEach(async () => {
  for (const sessionId of sessionIds.splice(0)) {
    await deleteSession(sessionId);
  }
});

describe("resident chat session cache", () => {
  test("reloads an evicted persisted transcript without losing messages", async () => {
    for (let index = 0; index < 26; index += 1) {
      const sessionId = `resident-reload-${crypto.randomUUID()}`;
      sessionIds.push(sessionId);
      await persistSession(
        sessionId,
        "resident-agent",
        [
          { role: "user", content: `request-${index}` },
          { role: "assistant", content: `response-${index}` },
        ],
        null,
        `Resident ${index}`
      );
      await upsertPersistedSessionMessage(
        sessionId,
        "resident-agent",
        { role: "user", content: `request-${index}` },
        { stableKey: `request-${index}` }
      );
      await upsertPersistedSessionMessage(
        sessionId,
        "resident-agent",
        { role: "assistant", content: `response-${index}` },
        { stableKey: `response-${index}` }
      );
    }

    const firstLoad = await getSession(sessionIds[0]);
    expect(firstLoad?.messages.map((message) => message.content)).toEqual([
      "request-0",
      "response-0",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 2));

    for (const sessionId of sessionIds.slice(1)) {
      expect(await getSession(sessionId)).toBeDefined();
    }

    const reloaded = await getSession(sessionIds[0]);
    expect(reloaded).not.toBe(firstLoad);
    expect(reloaded?.messages.map((message) => message.content)).toEqual([
      "request-0",
      "response-0",
    ]);
  });
});
