import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { formatSize, getTotalSize } from "../../scripts/package";

describe("package script utilities", () => {
  test("formatSize formats bytes, KB, and MB", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  test("getTotalSize sums nested directory sizes", () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-package-test-"));

    try {
      writeFileSync(join(dir, "a.txt"), "12345", "utf8");
      mkdirSync(join(dir, "nested"));
      writeFileSync(join(dir, "nested", "b.txt"), "1234567890", "utf8");

      expect(getTotalSize(dir)).toBe(15);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("getTotalSize returns 0 for missing directories", () => {
    expect(getTotalSize("/tmp/does-not-exist-cybara")).toBe(0);
  });
});
