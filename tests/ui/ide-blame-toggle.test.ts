import { describe, expect, test } from "bun:test";
import { readIdeUiSource } from "../source-fixtures";

const src = readIdeUiSource();

describe("IDE git blame — per-line toggle (Zed-style)", () => {
  test("has an all-lines blame toggle state", () => {
    expect(src).toContain("blameAllLines");
    expect(src).toContain("setBlameAllLines");
  });

  test("per-line blame shows on the active line OR when all-lines is enabled", () => {
    expect(src).toContain("(isActiveLine || blameAllLines) && showInlineBlame && !!blameLine");
  });

  test("toggle is only offered when git history is available", () => {
    expect(src).toContain('gitHistoryStatus === "ready" && blameLines.size > 0');
    expect(src).toContain("aria-pressed={blameAllLines}");
  });
});
