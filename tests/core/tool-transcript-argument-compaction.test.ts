import { describe, expect, test } from "bun:test";
import {
  compactOpenAIChatTranscriptInPlace,
  elidedToolCallArgumentsPayload,
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
      expect(value).toBe(elidedToolCallArgumentsPayload());
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
      expect(value).toBe(elidedToolCallArgumentsPayload());
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

  test("elided arguments stay valid JSON so providers accept the replay", () => {
    // Real replayed arguments are always JSON, because the wire serializer
    // guarantees it. Compaction must not turn valid JSON into a bare notice.
    const args = JSON.stringify({ path: "C:/a.ts", filler: "x".repeat(8_000) });
    const older = {
      role: "assistant",
      content: "working",
      tool_calls: [{ id: "json_0", type: "function", function: { name: "read", arguments: args } }],
    };
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    compactOpenAIChatTranscriptInPlace(messages, 2_000, { aggressive: true });
    const value = argsOf(older)[0] as string;
    expect(value).not.toBe(args);
    expect(() => JSON.parse(value)).not.toThrow();
    expect(isElidedToolCallArguments(value)).toBe(true);
    expect(value.length).toBeLessThanOrEqual(MAX_TOOL_CALL_ARGUMENT_CHARS);
  });

  test("reproduces the 112-payload replay shape without emitting invalid JSON", () => {
    // Faithful replica of the stored assistant row that triggered the report:
    // 115 replayed tool calls, 77_975 characters of serialized arguments, of
    // which 112 exceed the compaction notice length. Every emitted payload must
    // remain valid JSON or the provider rejects the whole request.
    const serializedLengths = [
      60, 57, 188, 276, 64, 311, 409, 220, 206, 175, 221, 240, 253, 304, 359, 80, 123, 174, 129,
      706, 85, 1096, 77, 772, 77, 201, 1562, 184, 1912, 270, 192, 340, 350, 552, 243, 333, 347, 261,
      300, 414, 31, 151, 473, 479, 239, 425, 1391, 119, 585, 134, 1959, 132, 1770, 116, 1184, 281,
      111, 284, 355, 359, 481, 111, 2000, 128, 1918, 372, 132, 338, 179, 386, 258, 811, 115, 1233,
      118, 6864, 168, 2967, 349, 423, 168, 475, 168, 1279, 145, 176, 3526, 201, 244, 265, 2827, 129,
      776, 198, 845, 907, 176, 129, 2373, 129, 157, 376, 110, 265, 5962, 219, 710, 248, 263, 151,
      5833, 376, 111, 2529, 1477,
    ];
    const calls = serializedLengths.map((length, index) => {
      const overhead = JSON.stringify({ filler: "" }).length;
      const args = { filler: "x".repeat(length - overhead) };
      expect(JSON.stringify(args).length).toBe(length);
      return {
        id: `replay_${index}`,
        type: "function",
        function: { name: "read", arguments: JSON.stringify(args) },
      };
    });
    const older = { role: "assistant", content: "working", tool_calls: calls };
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    const before = size(messages);
    expect(before).toBeGreaterThan(77_000);
    compactOpenAIChatTranscriptInPlace(messages, 20_000, { aggressive: true });

    const values = argsOf(older);
    expect(values).toHaveLength(115);
    let elided = 0;
    for (const value of values) {
      expect(() => JSON.parse(value)).not.toThrow();
      if (isElidedToolCallArguments(value)) elided += 1;
    }
    expect(elided).toBe(112);
  });

  test("keeps a bounded preview inside the argument budget as valid JSON", () => {
    const older = assistantWithCalls(1, 500_000, "preview");
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    compactOpenAIChatTranscriptInPlace(messages, 20_000, { aggressive: true });
    const value = argsOf(older)[0] as string;
    expect(value.length).toBeLessThanOrEqual(MAX_TOOL_CALL_ARGUMENT_CHARS);
    expect(() => JSON.parse(value)).not.toThrow();
    expect(isElidedToolCallArguments(value)).toBe(true);
  });

  test("keeps the compaction notice reachable for detection", () => {
    expect(isElidedToolCallArguments(TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE)).toBe(true);
    expect(isElidedToolCallArguments(elidedToolCallArgumentsPayload())).toBe(true);
    expect(isElidedToolCallArguments('{"path":"a.ts"}')).toBe(false);
  });

  test("keeps the elided marker shorter than the notice it replaces", () => {
    // The marker must be strictly shorter than the bare notice, otherwise
    // collapsing a payload between the two lengths grows the message instead
    // of shrinking it and the request can ratchet upward.
    expect(elidedToolCallArgumentsPayload().length).toBeLessThan(
      TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE.length
    );
  });

  test("never grows a message when collapsing arguments near the marker length", () => {
    // Regression guard: the elided marker must be shorter than the bare notice
    // it replaces, otherwise collapsing a message can make it larger.
    const markerLength = elidedToolCallArgumentsPayload().length;
    const originalLength = TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE.length + 1;
    const older = assistantWithCalls(250, originalLength, "grow");
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    const before = size(messages);
    compactOpenAIChatTranscriptInPlace(messages, 20_000, {
      aggressive: true,
      maxToolCallPayloadChars: 1_000,
    });
    const after = size(messages);
    expect(after).toBeLessThan(before);
    for (const value of argsOf(older)) {
      expect(() => JSON.parse(value)).not.toThrow();
      expect(value.length).toBeLessThan(originalLength);
      expect(value.length).toBeLessThanOrEqual(markerLength);
    }
  });

  test("keeps the collapsed payload shorter than the original it replaces", () => {
    const originalLength = TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE.length + 1;
    const original = "y".repeat(originalLength);
    const older = {
      role: "assistant",
      content: "working",
      tool_calls: [
        { id: "edge_0", type: "function", function: { name: "read", arguments: original } },
      ],
    };
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    compactOpenAIChatTranscriptInPlace(messages, 20_000, {
      aggressive: true,
      maxToolCallPayloadChars: 10,
    });
    const collapsed = argsOf(older)[0];
    expect(collapsed.length).toBeLessThan(original.length);
    expect(() => JSON.parse(collapsed)).not.toThrow();
    expect(isElidedToolCallArguments(collapsed)).toBe(true);
  });

  test("does not elide arguments that are already shorter than the payload", () => {
    const shorter = JSON.stringify({ path: "C:/a" });
    const older = {
      role: "assistant",
      content: "working",
      tool_calls: [
        { id: "keep_0", type: "function", function: { name: "read", arguments: shorter } },
      ],
    };
    const messages = [
      { role: "user", content: "go" },
      older,
      { role: "user", content: "again" },
      assistantWithCalls(1, 50, "newest"),
      { role: "user", content: "next" },
    ];
    compactOpenAIChatTranscriptInPlace(messages, 20_000, { aggressive: true });
    expect(argsOf(older)[0]).toBe(shorter);
  });
});
