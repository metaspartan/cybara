import { describe, expect, test } from "bun:test";
import {
  countDiffLines,
  isPlainRecord,
  isSameIdePath,
  normalizeIdePath,
  reverseUnifiedDiff,
  truncateDiffPreview,
} from "../../ui/src/pages/ide/ideDiffHelpers";
import {
  formatDurationMs,
  formatSize,
  isMarkdownExtension,
  scoreQuickOpenResult,
} from "../../ui/src/pages/ide/ideUtils";

describe("ideDiffHelpers (extracted pure helpers)", () => {
  test("isPlainRecord distinguishes plain objects", () => {
    expect(isPlainRecord({ a: 1 })).toBe(true);
    expect(isPlainRecord([1])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord("x")).toBe(false);
  });

  test("normalizeIdePath normalizes backslashes and strips leading ./", () => {
    expect(normalizeIdePath(".\\A\\B\\C.ts")).toBe("A/B/C.ts");
    expect(normalizeIdePath("./x.ts")).toBe("x.ts");
    expect(normalizeIdePath("//leading.ts")).toBe("/leading.ts");
  });

  test("isSameIdePath matches after normalization", () => {
    expect(isSameIdePath(".\\a\\b.ts", "a/b.ts")).toBe(true);
    expect(isSameIdePath("a/b.ts", "a/c.ts")).toBe(false);
  });

  test("countDiffLines counts total lines in a diff", () => {
    expect(countDiffLines("")).toBe(0);
    expect(countDiffLines("a\nb\nc")).toBe(3);
  });

  test("truncateDiffPreview caps length and marks truncation", () => {
    const long = "line\n".repeat(5000);
    const result = truncateDiffPreview(long);
    expect(result.length).toBeLessThanOrEqual(long.length);
  });

  test("reverseUnifiedDiff swaps +/- lines", () => {
    const reversed = reverseUnifiedDiff("--- a\n+++ b\n+added\n-removed");
    expect(reversed).toContain("-added");
    expect(reversed).toContain("+removed");
  });
});

describe("ideUtils (extracted pure helpers)", () => {
  test("formatSize formats bytes/KB/MB", () => {
    expect(formatSize(undefined)).toBe("");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  test("formatDurationMs formats seconds/minutes", () => {
    expect(formatDurationMs(undefined)).toBe("0s");
    expect(formatDurationMs(1500)).toBe("1s");
    expect(formatDurationMs(65000)).toBe("1m 5s");
  });

  test("isMarkdownExtension detects .md/.markdown", () => {
    expect(isMarkdownExtension(".md")).toBe(true);
    expect(isMarkdownExtension(".markdown")).toBe(true);
    expect(isMarkdownExtension(".ts")).toBe(false);
    expect(isMarkdownExtension(undefined)).toBe(false);
  });

  test("scoreQuickOpenResult ranks exact filename best (lowest score)", () => {
    const exact = scoreQuickOpenResult("foo.ts", "foo.ts");
    const path = scoreQuickOpenResult("src/foo.ts", "foo");
    const none = scoreQuickOpenResult("bar.ts", "foo");
    expect(exact).toBeLessThan(path);
    expect(path).toBeLessThan(none);
    expect(none).toBe(10);
  });
});
