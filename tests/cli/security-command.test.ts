import { describe, expect, spyOn, test } from "bun:test";
import {
  buildSecurityAgentArgs,
  runSecurityCommand,
  type SecurityCommandRuntime,
} from "../../src/cli/commands/security";

describe("security command", () => {
  test("dispatches scans through the selected Cybara agent", () => {
    expect(
      buildSecurityAgentArgs(
        ["scan", "repo", "--agent", "Mini", "--deep", "--working-tree", "--json"],
        "/workspace"
      )
    ).toEqual([
      "/security /workspace/repo\nUse a deep, exhaustive, multi-pass assessment.\nFocus on staged and unstaged working-tree changes.",
      "--workspace",
      "/workspace",
      "--agent",
      "Mini",
      "--json",
    ]);
  });

  test("uses the current workspace and configured default agent without arguments", () => {
    expect(buildSecurityAgentArgs([], "/workspace")).toEqual([
      "/security /workspace",
      "--workspace",
      "/workspace",
    ]);
  });

  test("passes the agent request through and reports success", async () => {
    const calls: string[][] = [];
    const runtime: SecurityCommandRuntime = {
      async runAgent(args) {
        calls.push(args);
      },
    };

    expect(await runSecurityCommand(["scan", "."], runtime, "/workspace")).toBe(0);
    expect(calls).toEqual([["/security /workspace", "--workspace", "/workspace"]]);
  });

  test("rejects unsupported scanner-specific options", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    const runtime: SecurityCommandRuntime = {
      async runAgent() {
        throw new Error("should not run");
      },
    };

    try {
      expect(await runSecurityCommand(["--model", "gpt"], runtime, "/workspace")).toBe(1);
      expect(error).toHaveBeenCalledWith(
        "Unable to run the security assessment: Unsupported security option: --model"
      );
    } finally {
      error.mockRestore();
    }
  });
});
