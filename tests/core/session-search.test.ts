import { afterAll, describe, expect, test } from "bun:test";
import db from "../../src/core/database";
import {
  ensureSessionSearchIndex,
  searchSessionMessages,
  toFtsQuery,
} from "../../src/core/session-search";

const sessionId = `sess-${crypto.randomUUID()}`;
const otherSessionId = `sess-${crypto.randomUUID()}`;

function insertMessage(id: string, session: string, role: string, content: string): void {
  db.query(
    "INSERT INTO session_messages (id, session_id, agent_id, role, content) VALUES (?, ?, ?, ?, ?)"
  ).run(id, session, "agent-test", role, content);
}

afterAll(() => {
  db.query("DELETE FROM session_messages WHERE session_id IN (?, ?)").run(
    sessionId,
    otherSessionId
  );
  db.query("DELETE FROM chat_sessions WHERE id IN (?, ?)").run(sessionId, otherSessionId);
});

describe("session search (FTS5)", () => {
  test("sanitizes queries into prefix phrase terms", () => {
    expect(toFtsQuery("hello world")).toBe('"hello"* AND "world"*');
    expect(toFtsQuery('drop"; --table')).toBe('"drop"* AND "table"*');
    expect(toFtsQuery("   ")).toBe("");
  });

  test("indexes new messages and returns ranked snippets", () => {
    ensureSessionSearchIndex();
    db.query("INSERT INTO chat_sessions (id, agent_id, title, messages) VALUES (?, ?, ?, ?)").run(
      sessionId,
      "agent-test",
      "Zebra migration plan",
      "[]"
    );
    insertMessage(
      `m-${crypto.randomUUID()}`,
      sessionId,
      "user",
      "how do we migrate the zebra database safely"
    );
    insertMessage(
      `m-${crypto.randomUUID()}`,
      sessionId,
      "assistant",
      "the zebra migration needs a rollback checkpoint first"
    );
    insertMessage(
      `m-${crypto.randomUUID()}`,
      otherSessionId,
      "user",
      "unrelated giraffe conversation"
    );

    const hits = searchSessionMessages("zebra");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].snippet).toContain("[");
    expect(hits.every((hit) => hit.sessionId === sessionId)).toBe(true);
    expect(hits[0].sessionTitle).toBe("Zebra migration plan");
  });

  test("filters by role and session", () => {
    const userOnly = searchSessionMessages("zebra", { role: "user" });
    expect(userOnly.every((hit) => hit.role === "user")).toBe(true);
    const scoped = searchSessionMessages("giraffe", { sessionId });
    expect(scoped.length).toBe(0);
  });

  test("empty and symbol-only queries return no results", () => {
    expect(searchSessionMessages("")).toEqual([]);
    expect(searchSessionMessages("!!! ???")).toEqual([]);
  });

  test("deleting a message removes it from the index", () => {
    const id = `m-${crypto.randomUUID()}`;
    insertMessage(id, sessionId, "assistant", "ephemeral quokka fact");
    expect(searchSessionMessages("quokka").length).toBe(1);
    db.query("DELETE FROM session_messages WHERE id = ?").run(id);
    expect(searchSessionMessages("quokka").length).toBe(0);
  });
});
