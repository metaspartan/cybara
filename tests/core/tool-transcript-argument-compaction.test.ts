import { describe, expect, test } from "bun:test";
import {
  compactOpenAIChatTranscriptInPlace,
  isElidedToolCallArguments,
  MAX_TOOL_CALL_ARGUMENT_CHARS,
  TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE,
} from "../../src/core/llm/tool-transcript";

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

const size = (messages: Record<string, unknown>[]): number =>
  messages.reduce((sum, message) => sum + JSON.stringify(message).length, 0);

const argsOf = (message: Record<string, unknown>): string[] =>
  (message.tool_calls as Record<string, unknown>[]).map((call) =>
    String((call.function as Record<string, unknown>).arguments)
  );

describe("tool call argument compaction", () => {
  test("leaves an in-budget transcript untouched", () => {
    const messages = [assistantWithCalls(1, 100, "a")];
    const before = size(messages);
    const elided = compactOpenAIChatTranscriptInPlace(messages, 1_000_000);
    expect(elided).toBe(0);
    expect(size(messages)).toBe(before);
  });

  test("protects the newest assistant turn so the loop can continue its tool calls", () => {
    const messages = [
      { role: "user", content: "go" },
      assistantWithCalls(1, 500_000, "newest"),
      { role: "user", content: "next" },
    ];
    compactOpenAIChatTranscriptInPlace(messages, 20_000, { aggressive: true });
    expect(argsOf(messages[1])[0]).toHaveLength(500_000);
  });

  test("bounds an oversized tool call argument on an older assistant turn", () => {
    const older = assistantWithCalls(1, 500_000, "old");
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    const elided = compactOpenAIChatTranscriptInPlace(messages, 20_000, { aggressive: true });
    expect(elided).toBeGreaterThan(0);
    const value = argsOf(older)[0];
    expect(value.length).toBeLessThanOrEqual(MAX_TOOL_CALL_ARGUMENT_CHARS);
    expect(isElidedToolCallArguments(value)).toBe(true);
  });

  test("collapses an older message carrying many tool calls and preserves call ids", () => {
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
    expect(calls).toHaveLength(60);
    expect(calls.map((call) => call.id)).toEqual(
      Array.from({ length: 60 }, (_, index) => `b_${index}`)
    );
    for (const value of argsOf(older)) {
      expect(value).toBe(TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE);
    }
  });

  test("respects an explicit per-message payload cap", () => {
    const older = assistantWithCalls(4, 5_000, "c");
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    compactOpenAIChatTranscriptInPlace(messages, 500_000, {
      maxToolCallPayloadChars: 1_000,
    });
    for (const value of argsOf(older)) {
      expect(value).toBe(TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE);
    }
  });

  test("shrinks a pathological transcript by an order of magnitude", () => {
    const messages: Record<string, unknown>[] = [{ role: "system", content: "rules" }];
    for (let index = 0; index < 40; index += 1) {
      messages.push({ role: "user", content: `ask ${index}` });
      messages.push(assistantWithCalls(30, 8_000, `m${index}`));
    }
    const before = size(messages);
    expect(before).toBeGreaterThan(9_000_000);
    compactOpenAIChatTranscriptInPlace(messages, 400_000, { aggressive: true });
    const after = size(messages);
    expect(after).toBeLessThan(before / 10);
    expect(after).toBeLessThanOrEqual(400_000 + 30 * MAX_TOOL_CALL_ARGUMENT_CHARS);
  });
});
