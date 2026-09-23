import { describe, expect, test } from "bun:test";
import { execFailureHint } from "../../src/core/tools/handlers/exec-failure-hint";

const installed =
  (...commands: string[]) =>
  (command: string) =>
    commands.includes(command) ? `/usr/bin/${command}` : null;

describe("execFailureHint", () => {
  test("points to python3 when python is missing", () => {
    const which = installed("python3");
    expect(execFailureHint(127, "sh: python: command not found", which)).toBe(
      "\npython is not installed here; use python3 instead."
    );
    expect(execFailureHint(127, "/bin/sh: 1: python: not found", which)).toContain("python3");
    expect(execFailureHint(127, "zsh: command not found: python", which)).toContain("python3");
  });

  test("prefers uv for a missing pip and falls back to python3 -m pip", () => {
    const output = "sh: pip: command not found";
    expect(execFailureHint(127, output, installed("uv", "python3"))).toContain("uv pip install");
    expect(execFailureHint(127, output, installed("python3"))).toContain("python3 -m pip");
    expect(execFailureHint(127, output, installed())).toBe("");
  });

  test("suggests uv for managed system Python and missing modules", () => {
    const uv = installed("uv", "python3");
    expect(
      execFailureHint(1, "error: externally-managed-environment\n× This environment", uv)
    ).toContain("uv venv then uv pip install");
    expect(execFailureHint(1, "ModuleNotFoundError: No module named 'yaml.loader'", uv)).toContain(
      "To use yaml without a global install, run uv run --with <package>"
    );
    expect(
      execFailureHint(1, "ModuleNotFoundError: No module named 'yaml'", installed("python3"))
    ).toBe("");
  });

  test("stays silent for successes and unrelated failures", () => {
    const which = installed("uv", "python3");
    expect(execFailureHint(0, "ModuleNotFoundError: No module named 'x'", which)).toBe("");
    expect(execFailureHint(1, "sh: python: command not found", which)).toBe("");
    expect(execFailureHint(127, "sh: node: command not found", which)).toBe("");
    expect(execFailureHint(127, "sh: python3: command not found", which)).toBe("");
  });
});
