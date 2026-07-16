import { describe, expect, test } from "bun:test";

import { sanitizeProcessThoughtText, stripThinkingTags } from "../../src/api/chat-formatting";
import { sanitizeSessionMessages } from "../../src/api/routes/_shared";

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

  test("strips provider reasoning tags from visible content", () => {
    const result = stripThinkingTags(
      "<mm:think>Search before answering.</mm:think>\nVisible answer.</think>"
    );

    expect(result.content).toBe("Visible answer.");
    expect(result.thinking).toBe("Search before answering.");
  });

  test("treats unclosed scratchpad tags as non-visible reasoning", () => {
    const result = stripThinkingTags("<REASONING_SCRATCHPAD>Plan privately first.");

    expect(result.content).toBe("");
    expect(result.thinking).toBe("Plan privately first.");
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

  test("removes direct XML tool requests from persisted thought activity", () => {
    expect(
      sanitizeProcessThoughtText("<read><file>/tmp/provider-tool-result.txt</file></read>")
    ).toBe("");
    expect(sanitizeProcessThoughtText("Inspecting the repository structure.")).toBe(
      "Inspecting the repository structure."
    );
  });

  test("sanitizes stored assistant text tool-call envelopes on session reads", () => {
    const [message] = sanitizeSessionMessages([
      {
        role: "assistant",
        content: [
          "I'll open the repository.",
          JSON.stringify(
            {
              name: "browser",
              arguments: { action: "open", url: "https://github.com/metaspartan/cybara" },
            },
            null,
            2
          ),
        ].join("\n"),
        timestamp: "2026-07-03T10:08:53.975Z",
        process_activities: [
          {
            id: "thought-tool-envelope",
            phase: "result",
            text: "<read><file>/tmp/provider-tool-result.txt</file></read>",
            timestamp: 1,
            toolName: "__thought",
          },
          {
            id: "thought-visible",
            phase: "result",
            text: "Inspecting the repository structure.",
            timestamp: 2,
            toolName: "__thought",
          },
        ],
      },
    ]);

    expect(message.content).toBe("I'll open the repository.");
    expect(message.process_activities?.map((activity) => activity.text)).toEqual([
      "Inspecting the repository structure.",
    ]);
  });

  test("repairs malformed completed responses when sessions are loaded", () => {
    const [message] = sanitizeSessionMessages([
      {
        role: "assistant",
        content: "Summary\n```text\nunfinished output",
      },
    ]);

    expect(message.content).toBe("Summary\n```text\nunfinished output\n```");
  });
});
