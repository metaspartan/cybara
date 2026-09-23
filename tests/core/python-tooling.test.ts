import { describe, expect, test } from "bun:test";
import { pythonToolingSummary } from "../../src/core/python-tooling";
import { buildSystemPrompt } from "../../src/core/system-prompt";

const installed =
  (...commands: string[]) =>
  (command: string) =>
    commands.includes(command) ? `/usr/bin/${command}` : null;

describe("python tooling summary", () => {
  test("names the interpreter and recommends uv for packages when present", () => {
    expect(pythonToolingSummary(installed("python3", "uv"))).toBe(
      "python3, uv for packages and venvs"
    );
    expect(pythonToolingSummary(installed("python", "python3"))).toBe("python3");
    expect(pythonToolingSummary(installed("python"))).toBe("python");
    expect(pythonToolingSummary(installed("uv"))).toBe("uv run python");
    expect(pythonToolingSummary(installed())).toBeUndefined();
  });

  test("appears in the runtime line only when provided", () => {
    const base = { workspaceDir: "/tmp", config: {}, modelDisplay: "m", tools: ["exec"] };
    expect(
      buildSystemPrompt({ ...base, runtimeInfo: { python: "python3, uv for packages and venvs" } })
    ).toContain("| python=python3, uv for packages and venvs");
    expect(buildSystemPrompt(base)).not.toContain("python=");
  });
});
