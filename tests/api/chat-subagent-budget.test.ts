import { describe, expect, test } from "bun:test";
import { resolveExplicitSubagentSpawnLimit } from "../../src/api/chat-subagent-budget";

describe("chat sub-agent budget", () => {
  test("reads an explicit child-agent count", () => {
    expect(resolveExplicitSubagentSpawnLimit("Spawn exactly two child agents in parallel.")).toBe(
      2
    );
    expect(resolveExplicitSubagentSpawnLimit("Use exactly 3 subagents for this task.")).toBe(3);
    expect(resolveExplicitSubagentSpawnLimit("Start exactly one parallel child agent.")).toBe(1);
  });

  test("does not infer an unstated spawn limit", () => {
    expect(resolveExplicitSubagentSpawnLimit("Use subagents where useful.")).toBeUndefined();
    expect(resolveExplicitSubagentSpawnLimit("Compare two agents.")).toBeUndefined();
    expect(resolveExplicitSubagentSpawnLimit("Use at least two child agents.")).toBeUndefined();
  });
});
