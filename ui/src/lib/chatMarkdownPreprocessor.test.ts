import { describe, expect, test } from "bun:test";
import { preprocessChatMarkdown } from "./chatMarkdownPreprocessor";

describe("preprocessChatMarkdown", () => {
  test("empty string returns empty string", () => {
    expect(preprocessChatMarkdown("")).toBe("");
  });

  test("plain text is trimmed but otherwise preserved", () => {
    expect(preprocessChatMarkdown("  hello world  ")).toBe("hello world");
  });

  test("normalizes CRLF to LF", () => {
    expect(preprocessChatMarkdown("a\r\nb")).toBe("a\nb");
  });

  test("collapses runs of blank lines to a single blank line", () => {
    expect(preprocessChatMarkdown("a\n\n\n\nb")).toBe("a\n\nb");
  });

  test("preserves fenced code blocks content", () => {
    const input = "text\n\n```js\nconst x = 1;\n```\n\nmore";
    const output = preprocessChatMarkdown(input);
    expect(output).toContain("```js");
    expect(output).toContain("const x = 1;");
    expect(output).toContain("```");
  });

  test("normalizes common inline and display math delimiters", () => {
    expect(preprocessChatMarkdown("Inline \\(x^2 + y^2\\) value")).toBe("Inline $x^2 + y^2$ value");
    expect(preprocessChatMarkdown("\\[\n\\sum_{i=1}^{n} i\n\\]")).toBe(
      "$$\n\n\\sum_{i=1}^{n} i\n\n$$"
    );
    expect(preprocessChatMarkdown("Display \\[x^2\\] now")).toBe("Display \n$$\nx^2\n$$\n now");
  });

  test("preserves math-like delimiters inside inline and fenced code", () => {
    const input = ["`\\(literal\\)`", "", "```tex", "\\[literal\\]", "```"].join("\n");
    expect(preprocessChatMarkdown(input)).toBe(input);
  });

  test("strips the header line of a non-json context block", () => {
    const input = ["Sender (untrusted metadata):", "alice", "", "Actual message body"].join("\n");
    const output = preprocessChatMarkdown(input);
    expect(output).not.toContain("Sender (untrusted metadata):");
    expect(output).toContain("alice");
    expect(output).toContain("Actual message body");
  });

  test("strips a fenced-json context block", () => {
    const input = [
      "Conversation info (untrusted metadata):",
      "```json",
      '{ "id": 1 }',
      "```",
      "Real content",
    ].join("\n");
    const output = preprocessChatMarkdown(input);
    expect(output).toBe("Real content");
    expect(output).not.toContain("json");
  });

  test("leaves content without context headers unchanged (minus trim)", () => {
    const input = "A message with untrusted in the middle but no header";
    expect(preprocessChatMarkdown(input)).toBe(input);
  });

  test("strips prefixed timestamps at line starts", () => {
    const input = "[Mon 2026-01-01 12:30 UTC] hello";
    expect(preprocessChatMarkdown(input)).toBe("hello");
  });

  test("strips GMT-offset timestamps", () => {
    const input = "[Tue 2026-06-15 08:05:09 GMT+2] status update";
    expect(preprocessChatMarkdown(input)).toBe("status update");
  });

  test("idempotent: running twice yields same result", () => {
    const input = [
      "Sender (untrusted metadata):",
      "bob",
      "",
      "[Mon 2026-01-01 12:30 UTC] hi there",
      "",
      "",
      "body",
    ].join("\n");
    const once = preprocessChatMarkdown(input);
    const twice = preprocessChatMarkdown(once);
    expect(twice).toBe(once);
  });

  test("handles malformed markdown without throwing", () => {
    expect(() => preprocessChatMarkdown("```\nunclosed fence")).not.toThrow();
    expect(() => preprocessChatMarkdown("# ] [ ) ( * _ ~")).not.toThrow();
  });

  test("handles unicode content", () => {
    const input = "日本語 テキスト 😀 emoji";
    expect(preprocessChatMarkdown(input)).toBe(input);
  });

  test("handles very long input without throwing", () => {
    const input = "x".repeat(500_000);
    expect(() => preprocessChatMarkdown(input)).not.toThrow();
    expect(preprocessChatMarkdown(input).length).toBe(500_000);
  });

  test("never throws across a variety of inputs", () => {
    const cases = ["", " ", "\r\n\r\n", "```", "Sender (untrusted metadata):", "[bad timestamp]"];
    for (const c of cases) {
      expect(() => preprocessChatMarkdown(c)).not.toThrow();
    }
  });
});
