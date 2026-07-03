import { describe, expect, test } from "bun:test";

import { extractTextToolCalls, stripTextToolCallMarkup } from "../../src/core/llm/text-tool-calls";

describe("text-form tool call parsing", () => {
  test("extracts OpenClaw-style invoke blocks from function_calls markup", () => {
    const calls = extractTextToolCalls(
      [
        "Let me calculate that.",
        "<function_calls>",
        '<invoke name="calc">',
        '<parameter name="expression">2 + 2</parameter>',
        "</invoke>",
        "</function_calls>",
      ].join("\n"),
      new Set(["calc"])
    );

    expect(calls).toEqual([{ name: "calc", args: { expression: "2 + 2" } }]);
  });

  test("extracts Hermes-style JSON tool_call blocks", () => {
    const calls = extractTextToolCalls(
      '<tool_call>{"name":"calc","arguments":{"expression":"sqrt(16)"}}</tool_call>',
      new Set(["calc"])
    );

    expect(calls).toEqual([{ name: "calc", args: { expression: "sqrt(16)" } }]);
  });

  test("drops text-form calls for tools outside the allowed set", () => {
    const calls = extractTextToolCalls(
      '<function_calls><invoke name="browser"><parameter name="action">open</parameter></invoke></function_calls>',
      new Set(["calc"])
    );

    expect(calls).toEqual([]);
  });

  test("keeps OpenClaw-style exact-name filtering for MiniMax-marked calls", () => {
    const raw = [
      "Let me search.",
      ']<]minimax[>[<tool_call> ]<]minimax[>[<invoke name="websearch"><query>metaspartan cybara</query></invoke></tool_call>',
      "Visible answer.",
    ].join("\n");

    expect(extractTextToolCalls(raw, new Set(["web_search"]))).toEqual([]);

    const cleaned = stripTextToolCallMarkup(raw);
    expect(cleaned).toContain("Let me search.");
    expect(cleaned).toContain("Visible answer.");
    expect(cleaned).not.toContain("minimax");
    expect(cleaned).not.toContain("tool_call");
    expect(cleaned).not.toContain("invoke");
  });

  test("extracts MiniMax-marked calls only when the tool name is exact", () => {
    const calls = extractTextToolCalls(
      ']<]minimax[>[<tool_call><invoke name="web_search"><query>metaspartan cybara</query></invoke></tool_call>',
      new Set(["web_search"])
    );

    expect(calls).toEqual([{ name: "web_search", args: { query: "metaspartan cybara" } }]);
  });

  test("extracts OpenClaw plain text tool request formats", () => {
    expect(extractTextToolCalls("[calc]\n{\"expression\":\"2 + 2\"}\n[END_TOOL_REQUEST]", new Set(["calc"]))).toEqual([
      { name: "calc", args: { expression: "2 + 2" } },
    ]);
    expect(
      extractTextToolCalls(
        "<function=calc>\n<parameter=expression>2 + 2</parameter>\n</function>",
        new Set(["calc"])
      )
    ).toEqual([{ name: "calc", args: { expression: "2 + 2" } }]);
  });

  test("strips malformed tool-call markup from visible assistant text", () => {
    const cleaned = stripTextToolCallMarkup(
      'Opening it now.\n<function_calls><invoke name="browser"><parameter name="action">open</parameter></invoke></function_calls>'
    );

    expect(cleaned).toBe("Opening it now.");
  });
});
