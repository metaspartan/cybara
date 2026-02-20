import { describe, expect, test } from "bun:test";
import { handleFileSearch } from "../../src/core/tools/handlers/file";
import { handleExec } from "../../src/core/tools/handlers/process";

describe("Tool input validation", () => {
  test("exec returns structured validation output when command is missing", async () => {
    const result = await handleExec({});

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain("command is required");
  });

  test("file_search returns structured validation output when pattern is missing", async () => {
    const result = await handleFileSearch({});

    expect(result.files).toHaveLength(0);
    expect(result.error).toContain("pattern is required");
  });
});
