import { describe, expect, test } from "bun:test";

import { stripThinkingTags } from "../../src/api/chat-formatting";

describe("chat response formatting", () => {
  test("extracts thinking and shows only final content", () => {
    const result = stripThinkingTags(
      "<think>Check the files first.</think>\n<final>Done with the fix.</final>"
    );

    expect(result.content).toBe("Done with the fix.");
    expect(result.thinking).toBe("Check the files first.");
  });

  test("removes dangling assistant markup from visible content", () => {
    const result = stripThinkingTags("</think>\nThe visible answer.");

    expect(result.content).toBe("The visible answer.");
    expect(result.thinking).toBe("");
  });

  test("treats an unclosed think block as non-visible reasoning", () => {
    const result = stripThinkingTags("<think>I should inspect the code\nand then run tests");

    expect(result.content).toBe("");
    expect(result.thinking).toBe("I should inspect the code\nand then run tests");
  });

  test("removes leaked text-form tool calls from visible content", () => {
    const result = stripThinkingTags(
      [
        "Let me try the browser.",
        "<function_calls>",
        '<invoke name="browser">',
        '<parameter name="action">open</parameter>',
        '<parameter name="url">https://github.com/metaspartan/cybara</parameter>',
        "</invoke>",
        "</function_calls>",
      ].join("\n")
    );

    expect(result.content).toBe("Let me try the browser.");
    expect(result.thinking).toBe("");
  });
});
