import { afterEach, describe, expect, test } from "bun:test";
import db, { tables } from "../../src/core/database";

const createdAgentIds = new Set<string>();

afterEach(() => {
  for (const id of createdAgentIds) {
    db.query("DELETE FROM agents WHERE id = ?").run(id);
  }
  createdAgentIds.clear();
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
