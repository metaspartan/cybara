import { afterEach, describe, expect, test } from "bun:test";
import db, { tables } from "../../src/core/database";

const createdAgentIds = new Set<string>();
const createdMcpIds = new Set<string>();

afterEach(() => {
  for (const id of createdAgentIds) {
    db.query("DELETE FROM agents WHERE id = ?").run(id);
  }
  createdAgentIds.clear();
  for (const id of createdMcpIds) {
    tables.mcpServers.delete(id);
  }
  createdMcpIds.clear();
});

describe("database JSON serialization", () => {
  test("keeps pre-serialized tools JSON stable across updates", () => {
    const id = `agent-${crypto.randomUUID()}`;
    createdAgentIds.add(id);

    tables.agents.create({
      id,
      name: "Serialization Test",
      status: "stopped",
      memory_enabled: false,
      tools: [{ name: "read", description: "Read file" }],
      config: { mode: "strict" },
    });

    const before = db.query("SELECT tools, config FROM agents WHERE id = ?").get(id) as
      | { tools: string; config: string }
      | undefined;
    expect(before).toBeDefined();
    expect(before?.tools.startsWith("[")).toBe(true);
    expect(before?.config.startsWith("{")).toBe(true);

    const stored = tables.agents.get(id) as Record<string, unknown>;
    tables.agents.update(id, {
      name: stored.name as string,
      type: stored.type as
        | "main"
        | "subagent"
        | "worker"
        | "research"
        | "coder"
        | "planner"
        | "ops"
        | undefined,
      model: stored.model as string | undefined,
      provider_id: stored.provider_id as string | undefined,
      system_prompt: stored.system_prompt as string | undefined,
      tools: stored.tools as unknown as Array<{ name: string }>,
      config: stored.config as Record<string, unknown>,
      status: (stored.status as "running" | "stopped" | "error") || "stopped",
      memory_enabled: stored.memory_enabled === true || stored.memory_enabled === 1,
      fallback_provider_id: stored.fallback_provider_id as string | undefined,
    } as Parameters<typeof tables.agents.update>[1]);

    const after = db.query("SELECT tools, config FROM agents WHERE id = ?").get(id) as
      | { tools: string; config: string }
      | undefined;
    expect(after).toBeDefined();
    expect(after?.tools).toBe(before?.tools);
    expect(after?.config).toBe(before?.config);
    expect(after?.tools.startsWith('"')).toBe(false);
    expect(after?.config.startsWith('"')).toBe(false);
  });
});

describe("database integrity", () => {
  test("enforces session event sequence uniqueness and cascading deletion", () => {
    const foreignKeys = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(foreignKeys.foreign_keys).toBe(1);
    const sessionId = `integrity-${crypto.randomUUID()}`;
    db.query(
      "INSERT INTO chat_sessions (id, agent_id, messages, created_at) VALUES (?, ?, '[]', CURRENT_TIMESTAMP)"
    ).run(sessionId, "integrity-agent");
    db.query(
      "INSERT INTO session_events (id, session_id, run_id, sequence, event_type, payload) VALUES (?, ?, ?, 1, 'run_started', '{}')"
    ).run(crypto.randomUUID(), sessionId, "run-one");

    expect(() =>
      db
        .query(
          "INSERT INTO session_events (id, session_id, run_id, sequence, event_type, payload) VALUES (?, ?, ?, 1, 'status', '{}')"
        )
        .run(crypto.randomUUID(), sessionId, "run-one")
    ).toThrow();

    db.query("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);
    const remaining = db
      .query("SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?")
      .get(sessionId) as { count: number };
    expect(remaining.count).toBe(0);
  });

  test("preserves omitted MCP fields during partial updates", () => {
    const id = `mcp-${crypto.randomUUID()}`;
    createdMcpIds.add(id);
    tables.mcpServers.create({
      id,
      name: "Original MCP",
      command: "bunx",
      args: "server.ts",
      env: '{"TOKEN":"secret"}',
      enabled: true,
    });

    tables.mcpServers.update(id, { name: "Renamed MCP" });

    expect(tables.mcpServers.get(id)).toMatchObject({
      name: "Renamed MCP",
      command: "bunx",
      args: "server.ts",
      env: '{"TOKEN":"secret"}',
      enabled: 1,
    });
  });
});
