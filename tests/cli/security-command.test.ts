import { describe, expect, spyOn, test } from "bun:test";
import {
  buildSecurityCommand,
  CODEX_SECURITY_PACKAGE,
  runSecurityCommand,
  type SecurityCommandRuntime,
} from "../../src/cli/commands/security";

describe("security command", () => {
  test("runs the pinned scanner package through Bun", () => {
    expect(buildSecurityCommand("/runtime/bun", ["scan", ".", "--dry-run"])).toEqual([
      "/runtime/bun",
      "x",
      "--bun",
      CODEX_SECURITY_PACKAGE,
      "scan",
      ".",
      "--dry-run",
    ]);
    expect(CODEX_SECURITY_PACKAGE).toMatch(/^@openai\/codex-security@\d+\.\d+\.\d+$/);
  });

  test("shows scanner help when no arguments are provided", () => {
    expect(buildSecurityCommand("bun", [])).toEqual([
      "bun",
      "x",
      "--bun",
      CODEX_SECURITY_PACKAGE,
      "--help",
    ]);
  });

  test("passes through the working directory and child exit code", async () => {
    const calls: Array<{ command: string[]; cwd: string }> = [];
    const runtime: SecurityCommandRuntime = {
      async resolveBun() {
        return "/portable/bun";
      },
      async run(command, cwd) {
        calls.push({ command, cwd });
        return 2;
      },
    };

    const exitCode = await runSecurityCommand(["scan", "repo"], runtime, "/workspace");

    expect(exitCode).toBe(2);
    expect(calls).toEqual([
      {
        command: ["/portable/bun", "x", "--bun", CODEX_SECURITY_PACKAGE, "scan", "repo"],
        cwd: "/workspace",
      },
    ]);
  });

  test("returns a failure without hiding runtime setup errors", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    const runtime: SecurityCommandRuntime = {
      async resolveBun() {
        throw new Error("runtime unavailable");
      },
      async run() {
        return 0;
      },
    };

    try {
      expect(await runSecurityCommand([], runtime, "/workspace")).toBe(1);
      expect(error).toHaveBeenCalledWith("Unable to run the security scanner: runtime unavailable");
    } finally {
      error.mockRestore();
    }
  });
});
