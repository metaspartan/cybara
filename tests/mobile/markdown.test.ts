import { describe, expect, test } from "bun:test";
import {
  mobileCodeLineCount,
  parseInlineMarkdown,
  parseMarkdownBlocks,
} from "../../apps/mobile/src/lib/chat-format";

describe("parseInlineMarkdown", () => {
  test("plain text is a single text token", () => {
    expect(parseInlineMarkdown("hello world")).toEqual([{ type: "text", text: "hello world" }]);
  });

  test("bold, italic, code, strikethrough", () => {
    expect(parseInlineMarkdown("a **b** c")).toEqual([
      { type: "text", text: "a " },
      { type: "bold", text: "b" },
      { type: "text", text: " c" },
    ]);
    expect(parseInlineMarkdown("*x*")).toEqual([{ type: "italic", text: "x" }]);
    expect(parseInlineMarkdown("use `code` here")[1]).toEqual({
      type: "code",
      text: "code",
    });
    expect(parseInlineMarkdown("~~gone~~")).toEqual([{ type: "strike", text: "gone" }]);
  });

  test("links capture text + href", () => {
    expect(parseInlineMarkdown("see [docs](https://x.dev)")).toEqual([
      { type: "text", text: "see " },
      { type: "link", text: "docs", href: "https://x.dev" },
    ]);
  });

  test("bold wins over italic for ** and the run continues", () => {
    const tokens = parseInlineMarkdown("**Cybara** is great");
    expect(tokens[0]).toEqual({ type: "bold", text: "Cybara" });
    expect(tokens[1]).toEqual({ type: "text", text: " is great" });
  });
});

describe("parseMarkdownBlocks", () => {
  test("headings by level", () => {
    const blocks = parseMarkdownBlocks("# Title\n## Sub\n### Small");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "heading", "heading"]);
    expect((blocks[0] as { level: number }).level).toBe(1);
    expect((blocks[1] as { level: number }).level).toBe(2);
  });

  test("paragraphs, lists, blockquote, and rule", () => {
    const blocks = parseMarkdownBlocks(
      "Intro paragraph.\n\n- one\n- two\n\n1. first\n\n> quoted\n\n---"
    );
    const types = blocks.map((b) => b.type);
    expect(types).toContain("paragraph");
    expect(types).toContain("listItem");
    expect(types).toContain("quote");
    expect(types).toContain("rule");
    const ordered = blocks.find((b) => b.type === "listItem" && b.ordered);
    expect(ordered).toBeDefined();
  });

  test("GFM task lists expose checked state without rendering raw markers", () => {
    const blocks = parseMarkdownBlocks("- [x] shipped\n- [ ] pending\n- ordinary");
    expect(blocks).toEqual([
      {
        type: "listItem",
        ordered: false,
        marker: "•",
        inline: [{ type: "text", text: "shipped" }],
        checked: true,
      },
      {
        type: "listItem",
        ordered: false,
        marker: "•",
        inline: [{ type: "text", text: "pending" }],
        checked: false,
      },
      {
        type: "listItem",
        ordered: false,
        marker: "•",
        inline: [{ type: "text", text: "ordinary" }],
        checked: undefined,
      },
    ]);
  });

  test("GFM table with header + rows", () => {
    const blocks = parseMarkdownBlocks(
      "| Layer | Stack |\n| --- | --- |\n| CLI | TSX |\n| Desktop | Tauri |"
    );
    expect(blocks).toHaveLength(1);
    const table = blocks[0] as {
      type: "table";
      header: unknown[];
      rows: unknown[][];
    };
    expect(table.type).toBe("table");
    expect(table.header).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
  });

  test("does not treat a lone pipe line as a table without a separator", () => {
    const blocks = parseMarkdownBlocks("a | b is just text");
    expect(blocks[0].type).toBe("paragraph");
  });
});

describe("mobileCodeLineCount", () => {
  test("matches desktop code metadata for trailing fenced newlines", () => {
    expect(mobileCodeLineCount("const ok = true;\n")).toBe(1);
    expect(mobileCodeLineCount("one\r\ntwo\r\nthree")).toBe(3);
    expect(mobileCodeLineCount("")).toBe(0);
  });
});
