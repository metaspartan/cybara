import { describe, expect, test } from "bun:test";
import {
  deletePreviousWord,
  nextWordCursor,
  previousWordCursor,
} from "../../src/cli/tui/interactive-chat-data";

describe("CLI TUI input editing", () => {
  test("moves across words without crossing input boundaries", () => {
    const value = "review the current workspace";
    expect(previousWordCursor(value, value.length)).toBe(19);
    expect(previousWordCursor(value, 11)).toBe(7);
    expect(previousWordCursor(value, 0)).toBe(0);
    expect(nextWordCursor(value, 0)).toBe(7);
    expect(nextWordCursor(value, 7)).toBe(11);
    expect(nextWordCursor(value, value.length)).toBe(value.length);
  });

  test("deletes the previous word while preserving text after the cursor", () => {
    expect(deletePreviousWord("review this workspace now", 22)).toEqual(["review this now", 12]);
    expect(deletePreviousWord("unchanged", 0)).toEqual(["unchanged", 0]);
  });
});
