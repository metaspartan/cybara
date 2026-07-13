import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRead } from "../../src/core/tools/handlers/file";

describe("file reads", () => {
  test("reads line ranges without loading unrelated content into the result", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-file-read-range-"));
    const path = join(directory, "large.log");
    try {
      writeFileSync(
        path,
        Array.from({ length: 10_000 }, (_, index) => `line-${index + 1}`).join("\n")
      );

      const result = await handleRead({ path, offset: 9_000, limit: 3 });

      expect(result.content).toBe("line-9000\nline-9001\nline-9002");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("bounds very large single-line files while the caller heartbeat continues", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-file-read-bounded-"));
    const path = join(directory, "single-line.log");
    try {
      writeFileSync(path, "x".repeat(12_000_000));
      let ticks = 0;
      const heartbeat = setInterval(() => {
        ticks += 1;
      }, 1);

      const result = await handleRead({ path });
      clearInterval(heartbeat);

      expect(result.content.startsWith("x".repeat(100))).toBe(true);
      expect(result.content.length).toBeLessThan(2_100_000);
      expect(result.content).toContain("[Read truncated");
      expect(ticks).toBeGreaterThan(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
