import { describe, expect, test } from "bun:test";
import { parseTerminalListItem, splitTerminalInline } from "../../src/cli-tui-markdown";

describe("CLI TUI markdown", () => {
  test("formats common inline Markdown without dropping surrounding text", () => {
    expect(
      splitTerminalInline(
        "Use **bold**, *italic*, ~~old~~, `bun test`, and [docs](https://example.com)."
      )
    ).toEqual([
      { text: "Use " },
      { text: "bold", bold: true },
      { text: ", " },
      { text: "italic", italic: true },
      { text: ", " },
      { text: "old", strikethrough: true },
      { text: ", " },
      { text: "bun test", code: true },
      { text: ", and " },
      { text: "docs", bold: true },
      { text: " (https://example.com)", dim: true },
      { text: "." },
    ]);
  });

  test("recognizes task, bullet, and numbered list rows", () => {
    expect(parseTerminalListItem("- [x] shipped")).toEqual({
      kind: "task",
      indent: "",
      checked: true,
      content: "shipped",
    });
    expect(parseTerminalListItem("  - pending")).toEqual({
      kind: "bullet",
      indent: "  ",
      content: "pending",
    });
    expect(parseTerminalListItem("12) verify")).toEqual({
      kind: "ordered",
      indent: "",
      number: "12",
      content: "verify",
    });
    expect(parseTerminalListItem("plain text")).toBeNull();
  });

  test("keeps malformed markup readable", () => {
    expect(splitTerminalInline("**unclosed")).toEqual([{ text: "**unclosed" }]);
    expect(splitTerminalInline("")).toEqual([{ text: " " }]);
  });
});
