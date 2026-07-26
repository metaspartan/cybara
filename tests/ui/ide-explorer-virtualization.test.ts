import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src =
  readFileSync(fileURLToPath(new URL("../../ui/src/pages/IDE.tsx", import.meta.url)), "utf8") +
  readFileSync(
    fileURLToPath(new URL("../../ui/src/pages/ide/FileTree.tsx", import.meta.url)),
    "utf8"
  );

describe("IDE explorer virtualization correctness", () => {
  test("virtualization is disabled once a directory is expanded", () => {
    expect(src).toContain("!hasExpandedDirectoriesAtLevel");
    expect(src).toContain("filteredEntries.length >= EXPLORER_VIRTUALIZATION_MIN_ENTRIES");
    expect(src).toContain("level === 0");
  });

  test("the expanded-directory helper is actually referenced (not dead code)", () => {
    const uses = src.split("hasExpandedDirectoriesAtLevel").length - 1;
    expect(uses).toBeGreaterThanOrEqual(2);
  });

  test("browse cache is bounded for large workspace navigation", () => {
    expect(src).toContain("EXPLORER_BROWSE_CACHE_MAX_ENTRIES");
    expect(src).toContain("function setTreeBrowseCache");
    expect(src).toContain("while (treeBrowseCache.size > EXPLORER_BROWSE_CACHE_MAX_ENTRIES)");
    expect(src).not.toContain("treeBrowseCache.set(cacheKey, nextEntries);");
  });
});
