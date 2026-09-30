import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleGrep } from "../../src/core/tools/handlers/file";

interface GrepResult {
  results: Array<{ path: string; line: number; content: string }>;
  count: number;
  source: string;
  pattern: string;
  truncated: boolean;
}

async function withFixture<T>(name: string, body: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), `cybara-grep-${name}-`));
  try {
    return await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("grep fallback match integrity", () => {
  test("finds every match on consecutive lines", async () => {
    await withFixture("consecutive", async (dir) => {
      writeFileSync(join(dir, "seq.txt"), "token A\ntoken B\ntoken C\n");
      const result = (await handleGrep({
        pattern: "token",
        path: dir,
        caseSensitive: true,
        maxResults: 200,
      })) as GrepResult;
      expect(result.count).toBe(3);
      expect(result.results.map((r) => r.line)).toEqual([1, 2, 3]);
    });
  });

  test("returns only matching lines, never surrounding context", async () => {
    await withFixture("context", async (dir) => {
      writeFileSync(join(dir, "ctx.txt"), "alpha\nbeta\nneedle\ngamma\ndelta\n");
      const result = (await handleGrep({
        pattern: "needle",
        path: dir,
        context: 2,
        caseSensitive: true,
        maxResults: 200,
      })) as GrepResult;
      expect(result.count).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].line).toBe(3);
      expect(result.results[0].content).toBe("needle");
    });
  });

  test("counts matches, not result rows, across multiple files", async () => {
    await withFixture("multifile", async (dir) => {
      writeFileSync(join(dir, "a.txt"), "hit\nfiller\nfiller\nhit\n");
      writeFileSync(join(dir, "b.txt"), "hit\n");
      const result = (await handleGrep({
        pattern: "hit",
        path: dir,
        caseSensitive: true,
        maxResults: 200,
      })) as GrepResult;
      expect(result.count).toBe(3);
      expect(new Set(result.results.map((r) => r.path)).size).toBe(2);
    });
  });

  test("reports truncation at the result ceiling without dropping matches silently", async () => {
    await withFixture("ceiling", async (dir) => {
      writeFileSync(
        join(dir, "many.txt"),
        Array.from({ length: 20 }, (_, i) => `hit ${i}`).join("\n")
      );
      const result = (await handleGrep({
        pattern: "hit",
        path: dir,
        caseSensitive: true,
        maxResults: 5,
      })) as GrepResult;
      expect(result.count).toBe(5);
      expect(result.truncated).toBe(true);
    });
  });

  test("a zero-match corpus still reports zero without claiming a crash", async () => {
    await withFixture("empty", async (dir) => {
      writeFileSync(join(dir, "none.txt"), "alpha\nbeta\n");
      const result = (await handleGrep({
        pattern: "zzzzz-not-present",
        path: dir,
        caseSensitive: true,
        maxResults: 200,
      })) as GrepResult;
      expect(result.count).toBe(0);
      expect(result.results).toEqual([]);
      expect(["javascript", "ripgrep"]).toContain(result.source);
    });
  });
});
