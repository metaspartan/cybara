import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import db, { tables } from "../../src/core/database";
import { searchAllLogs, getRecentActivity } from "../../src/core/logging";

const sessionIds: string[] = [];

function createSession(label: string): string {
  const id = `${label}_${randomUUID()}`;
  sessionIds.push(id);
  tables.chatSessions.ensure(id, "test-agent");
  return id;
}

afterEach(() => {
  for (const sessionId of sessionIds.splice(0)) {
    db.query("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    tables.chatSessions.delete(sessionId);
  }
});

describe("searchAllLogs (SQL-level filtering)", () => {
  test("finds matching rows across all four sources by query", async () => {
    const token = `zzq_${randomUUID().slice(0, 8)}`;

    tables.systemLogs.add({
      id: randomUUID(),
      level: "info",
      source: "test",
      message: `system ${token} entry`,
    });
    tables.agentLogs.add({ id: randomUUID(), agent_id: "a1", action: `did ${token}` });
    tables.channelLogs.add({
      id: randomUUID(),
      channel_type: "test",
      direction: "incoming",
      content: `channel ${token} msg`,
    });
    const sessionId = createSession("search");
    tables.sessionMessages.add({
      id: randomUUID(),
      session_id: sessionId,
      role: "user",
      content: `session ${token} text`,
    });

    const result = await searchAllLogs(token, 50);
    expect(result.system.length).toBeGreaterThanOrEqual(1);
    expect(result.agent.length).toBeGreaterThanOrEqual(1);
    expect(result.channel.length).toBeGreaterThanOrEqual(1);
    expect(result.sessionMessages.length).toBeGreaterThanOrEqual(1);
  });

  test("returns no matches for an absent token", async () => {
    const result = await searchAllLogs(`absent_${randomUUID()}`, 50);
    expect(result.system).toHaveLength(0);
    expect(result.agent).toHaveLength(0);
    expect(result.channel).toHaveLength(0);
    expect(result.sessionMessages).toHaveLength(0);
  });

  test("clamps an absurd limit", async () => {
    const result = await searchAllLogs("x", 10_000_000);
    expect(result.system.length).toBeLessThanOrEqual(1000);
  });
});

describe("getRecentActivity (windowed by created_at)", () => {
  test("excludes rows older than the window and includes recent ones", async () => {
    const token = `rec_${randomUUID().slice(0, 8)}`;
    const oldTs = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const oldSessionId = createSession("old");
    const newSessionId = createSession("new");

    tables.sessionMessages.add({
      id: randomUUID(),
      session_id: oldSessionId,
      role: "user",
      content: `old ${token}`,
      created_at: oldTs,
    });
    tables.sessionMessages.add({
      id: randomUUID(),
      session_id: newSessionId,
      role: "user",
      content: `new ${token}`,
    });

    const recent = await getRecentActivity(60);
    const msgs = recent.messages as Array<{ content: string }>;
    expect(msgs.some((m) => m.content === `new ${token}`)).toBe(true);
    expect(msgs.some((m) => m.content === `old ${token}`)).toBe(false);
  });
});
