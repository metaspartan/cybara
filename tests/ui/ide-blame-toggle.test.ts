import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/ide/CodeViewer.tsx", import.meta.url)),
  "utf8"
);

describe("IDE git blame — per-line toggle (Zed-style)", () => {
  test("has an all-lines blame toggle state", () => {
    expect(src).toContain("blameAllLines");
    expect(src).toContain("setBlameAllLines");
  });

  test("per-line blame shows on the active line OR when all-lines is enabled", () => {
    // Reuses the existing aligned inline-blame render path; only the gate widens.
    expect(src).toContain("(isActiveLine || blameAllLines) && showInlineBlame && !!blameLine");
  });

  test("toggle is only offered when git history is available", () => {
    expect(src).toContain('gitHistoryStatus === "ready" && blameLines.size > 0');
    expect(src).toContain("aria-pressed={blameAllLines}");
  });
});
