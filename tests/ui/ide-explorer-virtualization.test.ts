import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The FileTree/virtualization logic was extracted into ide/FileTree.tsx.
const src =
  readFileSync(fileURLToPath(new URL("../../ui/src/pages/IDE.tsx", import.meta.url)), "utf8") +
  readFileSync(
    fileURLToPath(new URL("../../ui/src/pages/ide/FileTree.tsx", import.meta.url)),
    "utf8"
  );

describe("IDE explorer virtualization correctness", () => {
  test("virtualization is disabled once a directory is expanded", () => {
    // Nested children render inside the parent row, so fixed-row-height spacer
    // math is only valid for a flat list. The gate must include the expanded
    // check that was previously computed but unused.
    expect(src).toContain("!hasExpandedDirectoriesAtLevel");
    // The gate still virtualizes large flat root lists.
    expect(src).toContain("filteredEntries.length >= EXPLORER_VIRTUALIZATION_MIN_ENTRIES");
    expect(src).toContain("level === 0");
  });

  test("the expanded-directory helper is actually referenced (not dead code)", () => {
    const uses = src.split("hasExpandedDirectoriesAtLevel").length - 1;
    // Declaration + at least one use in the gate.
    expect(uses).toBeGreaterThanOrEqual(2);
  });
});
