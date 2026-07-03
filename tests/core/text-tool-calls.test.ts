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

  test("strips malformed tool-call markup from visible assistant text", () => {
    const cleaned = stripTextToolCallMarkup(
      'Opening it now.\n<function_calls><invoke name="browser"><parameter name="action">open</parameter></invoke></function_calls>'
    );

    expect(cleaned).toBe("Opening it now.");
  });
});
