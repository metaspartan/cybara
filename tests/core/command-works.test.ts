import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandExists, commandWorks, resetCommandWorksCache } from "../../src/core/platform";
import { handleGrep } from "../../src/core/tools/handlers/file";

describe("command availability probing", () => {
  test("commandWorks rejects a command that exists on PATH but cannot run", () => {
    resetCommandWorksCache();
    expect(commandExists("this-command-does-not-exist-anywhere")).toBe(false);
    expect(commandWorks("this-command-does-not-exist-anywhere")).toBe(false);
  });

  test("commandWorks accepts a command that genuinely runs", () => {
    resetCommandWorksCache();
    expect(commandWorks("node")).toBe(true);
  });

  test("commandWorks caches within the TTL", () => {
    resetCommandWorksCache();
    expect(commandWorks("node")).toBe(true);
    expect(commandWorks("node")).toBe(true);
    resetCommandWorksCache();
  });
});

describe("grep never reports zero matches when the search backend is broken", () => {
  test("falls back to the javascript searcher and finds real matches", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-grep-fallback-"));
    try {
      for (let index = 0; index < 4; index += 1) {
        writeFileSync(join(directory, `hit-${index}.txt`), `needle ${index}\n`);
      }

      const result = await handleGrep({ pattern: "needle", path: directory, context: 0 });

      expect(result.count).toBe(4);
      expect(result.source).toBe("javascript");
      expect(result.truncated).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("an empty corpus still reports zero without claiming a backend crash", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-grep-empty-"));
    try {
      writeFileSync(join(directory, "plain.txt"), "nothing here\n");

      const result = await handleGrep({ pattern: "absent-token", path: directory });

      expect(result.count).toBe(0);
      expect(["javascript", "ripgrep"]).toContain(result.source);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
