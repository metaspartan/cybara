import { describe, expect, test } from "bun:test";
import { journeyDisplayText } from "../../src/api/journey";

describe("journey display text", () => {
  test("removes markdown chrome without losing readable content", () => {
    expect(
      journeyDisplayText(
        "## 1. **Bounded search** uses `Bun.Glob` and [the index](https://example.com).",
        120
      )
    ).toBe("1. Bounded search uses Bun.Glob and the index.");
  });

  test("collapses multiline memory content and truncates at the display boundary", () => {
    expect(journeyDisplayText("- first\n- second\n- third", 18)).toBe("first second third");
    expect(journeyDisplayText("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
  });
});
