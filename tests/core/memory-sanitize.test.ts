import { describe, expect, test } from "bun:test";
import { sanitizeMemoryContent } from "../../src/core/memory/sanitize";

const ZWSP = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);
const BOM = String.fromCharCode(0xfeff);
const NUL = String.fromCharCode(0x00);

describe("sanitizeMemoryContent", () => {
  test("strips zero-width, bidi-override, BOM, and control chars", () => {
    expect(sanitizeMemoryContent(`hi${ZWSP}there`)).toBe("hithere");
    expect(sanitizeMemoryContent(`a${RLO}b`)).toBe("ab");
    expect(sanitizeMemoryContent(`${BOM}start`)).toBe("start");
    expect(sanitizeMemoryContent(`x${NUL}y`)).toBe("xy");
  });

  test("leaves normal text (incl. newlines/tabs/unicode letters) intact", () => {
    const ok = "The user prefers dark mode.\n\tCafé — 日本語 ✅";
    expect(sanitizeMemoryContent(ok)).toBe(ok);
  });

  test("handles non-strings", () => {
    expect(sanitizeMemoryContent(undefined as unknown as string)).toBe("");
  });
});
