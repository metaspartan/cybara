import { describe, expect, test } from "bun:test";
import {
  compactOpenAIChatTranscriptInPlace,
  ELIDED_TOOL_CALL_ARGUMENTS_FLAG,
  isElidedToolCallArguments,
  MAX_TOOL_CALL_ARGUMENT_CHARS,
  TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE,
} from "../../src/core/llm/tool-transcript";
import { describesInvalidToolCallArguments } from "../../src/core/llm/tool-call-argument-repair";
import {
  shouldRetryByRepairingToolCallArguments,
  toRepairedToolCallArgumentsRequestBody,
} from "../../src/core/llm/tool-call-argument-compat";

function assistantWithCalls(
  count: number,
  argsChars: number,
  idPrefix: string
): Record<string, unknown> {
  return {
    role: "assistant",
    content: "working",
    tool_calls: Array.from({ length: count }, (_, index) => ({
      id: `${idPrefix}_${index}`,
      type: "function",
      function: { name: "read", arguments: "y".repeat(argsChars) },
    })),
  };
}

const argsOf = (message: Record<string, unknown>): string[] =>
  (message.tool_calls as Record<string, unknown>[]).map((call) =>
    String((call.function as Record<string, unknown>).arguments)
  );

describe("elided tool call arguments stay decodable", () => {
  test("a compacted argument payload is valid JSON", () => {
    const older = assistantWithCalls(1, 500_000, "old");
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    compactOpenAIChatTranscriptInPlace(messages, 20_000, { aggressive: true });

    const value = argsOf(older)[0];
    expect(value.length).toBeLessThanOrEqual(MAX_TOOL_CALL_ARGUMENT_CHARS);
    // The payload must decode, otherwise the provider rejects the whole request.
    expect(() => JSON.parse(value)).not.toThrow();
    const parsed = JSON.parse(value) as Record<string, unknown>;
    expect(parsed[ELIDED_TOOL_CALL_ARGUMENTS_FLAG]).toBe(true);
    expect(parsed.notice).toBe(TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE);
    expect(isElidedToolCallArguments(value)).toBe(true);
  });

  test("a collapsed tool call payload is valid JSON", () => {
    const older = assistantWithCalls(60, 4_000, "b");
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    compactOpenAIChatTranscriptInPlace(messages, 20_000, { aggressive: true });

    const calls = older.tool_calls as Record<string, unknown>[];
    for (const call of calls) {
      const value = String((call.function as Record<string, unknown>).arguments);
      expect(() => JSON.parse(value)).not.toThrow();
      expect(isElidedToolCallArguments(value)).toBe(true);
    }
  });

  test("a payload that does not fit the budget still decodes", () => {
    const older = assistantWithCalls(1, 500_000, "old");
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    compactOpenAIChatTranscriptInPlace(messages, 200, { aggressive: true });
    const value = argsOf(older)[0];
    expect(() => JSON.parse(value)).not.toThrow();
  });
});

describe("invalid tool call argument rejections reach the repair path", () => {
  test("recognizes generic provider rejections", () => {
    expect(describesInvalidToolCallArguments("invalid tool call arguments")).toBe(true);
    expect(
      describesInvalidToolCallArguments("invalid tool call arguments (ref: 113f4141)")
    ).toBe(true);
    expect(describesInvalidToolCallArguments("malformed tool call arguments")).toBe(true);
    expect(describesInvalidToolCallArguments("rate limit exceeded")).toBe(false);
    expect(describesInvalidToolCallArguments("model not found")).toBe(false);
  });

  test("retries and repairs after a generic rejection", () => {
    const body = {
      model: "minimax-m3.1-flash:cloud",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "read",
                arguments: "[compacted: earlier tool call arguments elided to free context]",
              },
            },
          ],
        },
      ],
    };
    const errorText = "invalid tool call arguments (ref: 113f4141-e6b5-4557-83b2-f744a4f4c39c)";
    expect(shouldRetryByRepairingToolCallArguments(400, errorText, body)).toBe(true);

    const repaired = toRepairedToolCallArgumentsRequestBody(body);
    const messages = repaired.messages as Array<Record<string, unknown>>;
    const assistant = messages[1] as {
      tool_calls: Array<{ function: { arguments: string } }>;
    };
    const call = assistant.tool_calls[0];
    expect(call).toBeDefined();
    expect(() => JSON.parse(call?.function.arguments ?? "")).not.toThrow();
  });
});
