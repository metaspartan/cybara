import { describe, expect, test } from "bun:test";
import { getMinimapRowBudget } from "../../ui/src/pages/ide/codeViewerConfig";

describe("IDE minimap configuration", () => {
  test("scales row count to the viewport without excessive DOM nodes", () => {
    expect(getMinimapRowBudget(0)).toBe(120);
    expect(getMinimapRowBudget(600)).toBe(300);
    expect(getMinimapRowBudget(1080)).toBe(360);
    expect(getMinimapRowBudget(Number.NaN)).toBe(120);
  });
});
