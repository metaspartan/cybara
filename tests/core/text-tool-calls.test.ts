import { describe, expect, test } from "bun:test";

import {
  extractTextToolCalls,
  hasTextToolCallMarkup,
  sanitizeAssistantContent,
  stripTextToolCallMarkup,
} from "../../src/core/llm/text-tool-calls";
import {
  MESSAGE_CONTENT_COMPACTION_NOTICE,
  TOOL_RESULT_COMPACTION_NOTICE,
} from "../../src/core/llm/tool-transcript";

describe("text-form tool call parsing", () => {
  test("removes provider reply directives from final assistant text", () => {
    expect(sanitizeAssistantContent("Done.\n\n[[reply_to_current]]")).toBe("Done.");
    expect(sanitizeAssistantContent("Done.\n[[reply_to:message-42]]\nMore detail.")).toBe(
      "Done.\nMore detail."
    );
    expect(sanitizeAssistantContent("[[reply_to_current]] Answer starts here.")).toBe(
      "Answer starts here."
    );
    expect(sanitizeAssistantContent("[[ reply_to: message-42 ]] Answer starts here.")).toBe(
      "Answer starts here."
    );
  });

  test("never exposes internal context compaction notices as assistant text", () => {
    expect(sanitizeAssistantContent(MESSAGE_CONTENT_COMPACTION_NOTICE)).toBe("");
    expect(sanitizeAssistantContent(TOOL_RESULT_COMPACTION_NOTICE)).toBe("");
    expect(
      sanitizeAssistantContent(
        `${MESSAGE_CONTENT_COMPACTION_NOTICE}\n\nContinued with the preserved context.`
      )
    ).toBe("Continued with the preserved context.");
  });

  test("repairs unterminated fenced blocks in completed assistant text", () => {
    expect(sanitizeAssistantContent("Result:\n```ts\nconst value = 42;")).toBe(
      "Result:\n```ts\nconst value = 42;\n```"
    );
    expect(sanitizeAssistantContent("~~~text\nvalue\n~~~~")).toBe("~~~text\nvalue\n~~~~");
  });

  test("removes incomplete provider tool envelopes from completed assistant text", () => {
    expect(
      sanitizeAssistantContent(
        'I will inspect it.\n<tool_calls>\n<invoke name="read">\n<parameter name="path">README.md'
      )
    ).toBe("I will inspect it.");
  });

  test("preserves final prose after a completed provider tool envelope", () => {
    expect(
      sanitizeAssistantContent(
        'Checking now.\n<tool_calls><invoke name="read"><parameter name="path">README.md</parameter></invoke></tool_calls>\nThe project is ready.'
      )
    ).toBe("Checking now.\n\nThe project is ready.");
  });

  test("extracts invoke blocks from function_calls markup", () => {
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

  test("extracts JSON tool_call blocks", () => {
    const calls = extractTextToolCalls(
      '<tool_call>{"name":"calc","arguments":{"expression":"sqrt(16)"}}</tool_call>',
      new Set(["calc"])
    );

    expect(calls).toEqual([{ name: "calc", args: { expression: "sqrt(16)" } }]);
  });

  test("extracts MiniMax direct XML tool blocks", () => {
    const raw = [
      "<read>",
      "<file>/Users/carsen/.cybara/tool-results/session/snapshot.txt</file>",
      "</read>",
    ].join("\n");

    expect(extractTextToolCalls(raw, new Set(["read"]))).toEqual([
      {
        name: "read",
        args: {
          file: "/Users/carsen/.cybara/tool-results/session/snapshot.txt",
        },
      },
    ]);
    expect(stripTextToolCallMarkup(raw)).toBe("");
  });

  test("drops text-form calls for tools outside the allowed set", () => {
    const calls = extractTextToolCalls(
      '<function_calls><invoke name="browser"><parameter name="action">open</parameter></invoke></function_calls>',
      new Set(["calc"])
    );

    expect(calls).toEqual([]);
  });

  test("keeps exact-name filtering for MiniMax-marked calls", () => {
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

  test("extracts supported plain text tool request formats", () => {
    expect(
      extractTextToolCalls('[calc]\n{"expression":"2 + 2"}\n[END_TOOL_REQUEST]', new Set(["calc"]))
    ).toEqual([{ name: "calc", args: { expression: "2 + 2" } }]);
    expect(
      extractTextToolCalls(
        "<function=calc>\n<parameter=expression>2 + 2</parameter>\n</function>",
        new Set(["calc"])
      )
    ).toEqual([{ name: "calc", args: { expression: "2 + 2" } }]);
  });

  test("extracts final JSON tool envelopes without leaking them into visible text", () => {
    const raw = [
      "I'll open the repository.",
      "{",
      '  "name": "browser",',
      '  "arguments": {',
      '    "action": "open",',
      '    "url": "https://github.com/metaspartan/cybara"',
      "  }",
      "}",
    ].join("\n");

    expect(extractTextToolCalls(raw, new Set(["browser"]))).toEqual([
      {
        name: "browser",
        args: { action: "open", url: "https://github.com/metaspartan/cybara" },
      },
    ]);
    expect(stripTextToolCallMarkup(raw)).toBe("I'll open the repository.");
  });

  test("extracts standalone bare command JSON as exec", () => {
    const raw = '{"command":"cat package.json","cwd":"/Users/carsen/Documents/GitHub/cybara"}';

    expect(extractTextToolCalls(raw, new Set(["exec"]))).toEqual([
      {
        name: "exec",
        args: {
          command: "cat package.json",
          cwd: "/Users/carsen/Documents/GitHub/cybara",
        },
      },
    ]);
  });

  test("strips leading bare command JSON before visible prose", () => {
    const raw = [
      '{"command":"cat package.json","cwd":"/Users/carsen/Documents/GitHub/cybara"}',
      "Absolutely - here's a concise engineering review.",
    ].join("\n");

    expect(extractTextToolCalls(raw, new Set(["exec"]))).toEqual([]);
    expect(stripTextToolCallMarkup(raw)).toBe("Absolutely - here's a concise engineering review.");
  });

  test("does not promote text-form tool calls without an explicit allowed set", () => {
    expect(extractTextToolCalls('[calc]\n{"expression":"2 + 2"}\n[END_TOOL_REQUEST]')).toEqual([]);
    expect(extractTextToolCalls('{"name":"calc","arguments":{"expression":"2 + 2"}}')).toEqual([]);
    expect(extractTextToolCalls('{"command":"cat package.json"}')).toEqual([]);
  });

  test("does not treat non-final JSON examples as tool calls", () => {
    const raw = [
      "Example shape:",
      '{"name":"browser","arguments":{"action":"open"}}',
      "Use that shape only if a tool is available.",
    ].join("\n");

    expect(extractTextToolCalls(raw, new Set(["browser"]))).toEqual([]);
    expect(stripTextToolCallMarkup(raw)).toBe(raw);
  });

  test("strips malformed tool-call markup from visible assistant text", () => {
    const cleaned = stripTextToolCallMarkup(
      'Opening it now.\n<function_calls><invoke name="browser"><parameter name="action">open</parameter></invoke></function_calls>'
    );

    expect(cleaned).toBe("Opening it now.");
  });
});

describe("leaked DSML block cleanup", () => {
  test("extracts direct DSML tool calls and strips them from assistant text", () => {
    const raw = `<｜DSML｜tool_exec>
<command>sleep 90</command>
<timeout>120</timeout>
</｜DSML｜tool_exec>`;

    expect(extractTextToolCalls(raw, new Set(["exec"]))).toEqual([
      { name: "exec", args: { command: "sleep 90", timeout: 120 } },
    ]);
    expect(stripTextToolCallMarkup(raw)).toBe("");
    expect(hasTextToolCallMarkup(raw)).toBe(true);
  });

  test("extracts doubled-separator DSML invoke calls from stored DeepSeek output", () => {
    const raw = `All five fixes landed cleanly. Verifying now.

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="exec">
<｜｜DSML｜｜parameter name="command" string="true">bun test tests/core</｜｜DSML｜｜parameter>
<｜｜DSML｜｜parameter name="timeout" string="false">120</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`;

    expect(extractTextToolCalls(raw, new Set(["exec"]))).toEqual([
      { name: "exec", args: { command: "bun test tests/core", timeout: 120 } },
    ]);
    expect(stripTextToolCallMarkup(raw)).toBe("All five fixes landed cleanly. Verifying now.");
    expect(hasTextToolCallMarkup(raw)).toBe(true);
  });

  test("removes a dangling unclosed DSML block but keeps preceding prose", () => {
    const raw = `Opening the runner now.
<｜DSML｜tool_exec>
<command>nvidia-smi</command>`;

    expect(stripTextToolCallMarkup(raw)).toBe("Opening the runner now.");
  });

  test("removes stray DSML closing tags from otherwise-final text", () => {
    expect(stripTextToolCallMarkup("All done.</｜DSML｜tool_exec>")).toBe("All done.");
  });

  test("removes malformed DSML tails without exposing provider protocol text", () => {
    expect(stripTextToolCallMarkup("Working on it.\n<｜DSML｜tool we have: users")).toBe(
      "Working on it."
    );
  });
});
