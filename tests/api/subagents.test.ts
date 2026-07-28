import { describe, expect, test } from "bun:test";
import { isVisibleSubagentRun } from "../../src/api/subagents";
import type { SubagentRunRecord } from "../../src/core/subagent-registry";

function run(silent?: boolean): SubagentRunRecord {
  return {
    runId: crypto.randomUUID(),
    childSessionKey: `agent:test:subagent:${crypto.randomUUID()}`,
    requesterSessionKey: "parent-session",
    requesterDisplayKey: "parent-session",
    task: "inspect files",
    cleanup: "keep",
    createdAt: Date.now(),
    silent,
  };
}

describe("subagent API visibility", () => {
  test("shows user-requested runs and hides internal silent workers", () => {
    expect([run(), run(true)].filter(isVisibleSubagentRun)).toHaveLength(1);
  });
});
