import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { tables } from "../../src/core/database";
import { searchAllLogs, getRecentActivity } from "../../src/core/logging";

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
    tables.sessionMessages.add({
      id: randomUUID(),
      session_id: "s1",
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

    tables.sessionMessages.add({
      id: randomUUID(),
      session_id: `old_${token}`,
      role: "user",
      content: `old ${token}`,
      created_at: oldTs,
    });
    tables.sessionMessages.add({
      id: randomUUID(),
      session_id: `new_${token}`,
      role: "user",
      content: `new ${token}`,
    });

    const recent = await getRecentActivity(60);
    const msgs = recent.messages as Array<{ content: string }>;
    expect(msgs.some((m) => m.content === `new ${token}`)).toBe(true);
    expect(msgs.some((m) => m.content === `old ${token}`)).toBe(false);
  });
});
