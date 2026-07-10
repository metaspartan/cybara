import { describe, expect, test } from "bun:test";

import { buildUnifiedDiff } from "../../src/core/tools/handlers/file";

describe("file handler unified diff builder", () => {
  test("interleaves additions and removals instead of emitting full-file remove/add blocks", () => {
    const diff = buildUnifiedDiff(
      "README.md",
      ['<p align="center">', "old heading", "shared line", "old footer"].join("\n"),
      ['<p align="center">', "new heading", "shared line", "new footer"].join("\n")
    );

    expect(diff).toContain("@@ -1,4 +1,4 @@");
    expect(diff).toContain(' <p align="center">');
    expect(diff).toContain("-old heading");
    expect(diff).toContain("+new heading");
    expect(diff).toContain(" shared line");
    expect(diff).toContain("-old footer");
    expect(diff).toContain("+new footer");
    expect(diff.indexOf("-old heading")).toBeLessThan(diff.indexOf("+new heading"));
    expect(diff.indexOf(" shared line")).toBeLessThan(diff.indexOf("-old footer"));
  });

  test("preserves every line in large diffs", () => {
    const before = Array.from({ length: 260 }, (_, index) => `before ${index}`).join("\n");
    const after = Array.from({ length: 260 }, (_, index) => `after ${index}`).join("\n");
    const diff = buildUnifiedDiff("large.txt", before, after);

    expect(diff).toContain("-before 259");
    expect(diff).toContain("+after 259");
    expect(diff).not.toContain("[diff truncated");
  });
});
