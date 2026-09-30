import { describe, expect, test } from "bun:test";
import {
  compactOpenAIChatTranscriptInPlace,
  THINKING_COMPACTION_NOTICE,
  TOOL_CALL_RESULT_COMPACTION_NOTICE,
} from "../../src/core/llm/tool-transcript";

function timelineAssistant(
  count: number,
  argsChars: number,
  resultChars: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    role: "assistant",
    content: "working",
    tool_calls: Array.from({ length: count }, (_, index) => ({
      id: `call_${index}`,
      name: "read",
      args: { path: "a".repeat(argsChars) },
      result: { output: "b".repeat(resultChars) },
      status: "completed",
      duration: 12,
      timeline_index: index,
    })),
    ...overrides,
  };
}

const size = (messages: Record<string, unknown>[]): number =>
  messages.reduce((sum, message) => sum + JSON.stringify(message).length, 0);

const callsOf = (message: Record<string, unknown>): Record<string, unknown>[] =>
  message.tool_calls as Record<string, unknown>[];

describe("timeline tool call payload compaction", () => {
  test("collapses inline args and results on a historical turn while preserving identity", () => {
    const messages: Record<string, unknown>[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "start" },
      timelineAssistant(439, 2_000, 3_000),
      { role: "user", content: "more" },
    ];
    const before = size(messages);

    compactOpenAIChatTranscriptInPlace(messages, 384_000);

    const calls = callsOf(messages[2]);
    expect(calls).toHaveLength(439);
    expect(calls[0].id).toBe("call_0");
    expect(calls[0].name).toBe("read");
    expect(calls[0].status).toBe("completed");
    expect(calls[0].duration).toBe(12);
    expect(calls[0].timeline_index).toBe(0);
    expect(calls[0].args).toBe(TOOL_CALL_RESULT_COMPACTION_NOTICE);
    expect(calls[0].result).toBe(TOOL_CALL_RESULT_COMPACTION_NOTICE);
    expect(size(messages)).toBeLessThan(before * 0.2);
  });

  test("bounds a turn that is the newest assistant message but is far from the tail", () => {
    const messages: Record<string, unknown>[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "start" },
      timelineAssistant(439, 2_000, 3_000),
    ];
    for (let index = 0; index < 30; index += 1) {
      messages.push({ role: "system", content: `note ${index}` });
    }
    const before = size(messages);

    compactOpenAIChatTranscriptInPlace(messages, 384_000);

    expect(callsOf(messages[2])[0].result).toBe(TOOL_CALL_RESULT_COMPACTION_NOTICE);
    expect(size(messages)).toBeLessThan(before * 0.3);
  });

  test("keeps a genuinely in-flight trailing turn intact", () => {
    const pending = timelineAssistant(4, 10, 0);
    const calls = pending.tool_calls as Record<string, unknown>[];
    for (const call of calls) {
      delete call.result;
      call.status = "pending";
    }
    const messages: Record<string, unknown>[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "start" },
      timelineAssistant(200, 2_000, 2_000),
      pending,
    ];
    const beforePending = JSON.stringify(pending).length;

    compactOpenAIChatTranscriptInPlace(messages, 384_000);

    expect(callsOf(messages[2])[0].result).toBe(TOOL_CALL_RESULT_COMPACTION_NOTICE);
    expect(JSON.stringify(pending).length).toBe(beforePending);
  });
});

describe("thinking trace compaction", () => {
  function withTail(head: Record<string, unknown>[], tailCount: number): Record<string, unknown>[] {
    const messages = [...head];
    for (let index = 0; index < tailCount; index += 1) {
      messages.push({ role: "system", content: `note ${index}` });
    }
    return messages;
  }

  test("elides thinking on historical assistant turns under budget pressure", () => {
    const messages = withTail(
      [
        { role: "system", content: "system prompt" },
        { role: "user", content: "start" },
        { role: "assistant", content: "done", thinking: "r".repeat(400_000) },
      ],
      12
    );
    const before = size(messages);

    compactOpenAIChatTranscriptInPlace(messages, 384_000);

    expect(messages[2].thinking).toBe(THINKING_COMPACTION_NOTICE);
    expect(size(messages)).toBeLessThan(before * 0.1);
  });

  test("elides thinking even when message content was already elided", () => {
    const messages = withTail(
      [
        { role: "system", content: "system prompt" },
        { role: "user", content: "start" },
        {
          role: "assistant",
          content: "already elided reply",
          thinking: "r".repeat(400_000),
        },
      ],
      12
    );

    compactOpenAIChatTranscriptInPlace(messages, 384_000);

    expect(messages[2].thinking).toBe(THINKING_COMPACTION_NOTICE);
  });

  test("keeps thinking on a turn still inside the protected recent window", () => {
    const messages: Record<string, unknown>[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "start" },
      { role: "assistant", content: "done", thinking: "r".repeat(400_000) },
      { role: "user", content: "more" },
    ];
    const before = JSON.stringify(messages);

    compactOpenAIChatTranscriptInPlace(messages, 384_000);

    expect(messages[2].thinking).toBe("r".repeat(400_000));
    expect(JSON.stringify(messages)).toBe(before);
  });

  test("leaves an in-budget transcript untouched", () => {
    const messages: Record<string, unknown>[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "start" },
      { role: "assistant", content: "short", thinking: "brief reasoning" },
    ];
    const before = JSON.stringify(messages);

    compactOpenAIChatTranscriptInPlace(messages, 384_000);

    expect(JSON.stringify(messages)).toBe(before);
  });
});
