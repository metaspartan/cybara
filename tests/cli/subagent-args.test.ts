import { describe, expect, test } from "bun:test";
import { parseSubagentSpawnArgs } from "../../src/cli/commands/subagent-args";

describe("CLI subagent spawn argument parsing", () => {
  test("parses routing, workspace, timeout, cleanup, and task flags", () => {
    expect(
      parseSubagentSpawnArgs([
        "--agent",
        "agent-1",
        "--model",
        "gpt-cli",
        "--workspace",
        "/tmp/work",
        "--timeout",
        "120",
        "--cleanup",
        "delete",
        "--max-active",
        "3",
        "--session",
        "chat-1",
        "review",
        "repo",
      ])
    ).toEqual({
      agentId: "agent-1",
      model: "gpt-cli",
      workspaceDir: "/tmp/work",
      runTimeoutSeconds: 120,
      cleanup: "delete",
      maxActiveChildren: 3,
      requesterSessionId: "chat-1",
      task: "review repo",
      label: "Task: review repo...",
    });
  });

  test("supports literal task text after flag parsing terminator", () => {
    expect(parseSubagentSpawnArgs(["--no-timeout", "--", "--not-a-flag"])).toMatchObject({
      runTimeoutSeconds: 0,
      task: "--not-a-flag",
    });
  });

  test("rejects missing task and malformed flag values", () => {
    expect(() => parseSubagentSpawnArgs([])).toThrow("Please specify a task");
    expect(() => parseSubagentSpawnArgs(["--agent"])).toThrow("--agent requires a value");
    expect(() => parseSubagentSpawnArgs(["--timeout", "-1", "task"])).toThrow(
      "--timeout must be a non-negative number"
    );
    expect(() => parseSubagentSpawnArgs(["--cleanup", "later", "task"])).toThrow(
      "--cleanup must be keep or delete"
    );
  });
});
