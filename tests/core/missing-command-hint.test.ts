import { describe, expect, test } from "bun:test";
import { missingCommandHint } from "../../src/core/tools/handlers/missing-command-hint";

const available = (command: string) => (command === "python3" ? "/usr/bin/python3" : null);

describe("missingCommandHint", () => {
  test("points to python3 when python is missing and python3 exists", () => {
    expect(missingCommandHint(127, "sh: python: command not found", available)).toBe(
      "\npython is not installed here; use python3 instead."
    );
    expect(missingCommandHint(127, "/bin/sh: 1: python: not found", available)).toContain(
      "use python3"
    );
    expect(missingCommandHint(127, "zsh: command not found: python", available)).toContain(
      "use python3"
    );
  });

  test("stays silent for other failures or when no alternative is installed", () => {
    expect(missingCommandHint(1, "sh: python: command not found", available)).toBe("");
    expect(missingCommandHint(127, "sh: node: command not found", available)).toBe("");
    expect(missingCommandHint(127, "sh: pip: command not found", available)).toBe("");
    expect(missingCommandHint(127, "sh: python3: command not found", available)).toBe("");
  });
});
