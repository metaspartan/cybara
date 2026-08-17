import { describe, expect, test } from "bun:test";
import {
  compactOpenAIChatTranscriptInPlace,
  isContextCompactionOnlyContent,
  isContextOverflowError,
  MESSAGE_CONTENT_COMPACTION_NOTICE,
  stripContextCompactionNotices,
  TOOL_RESULT_COMPACTION_NOTICE,
} from "../../src/core/llm/tool-transcript";

describe("LLM tool transcript compaction", () => {
  test("recognizes and removes internal-only compaction responses", () => {
    expect(isContextCompactionOnlyContent(MESSAGE_CONTENT_COMPACTION_NOTICE)).toBe(true);
    expect(isContextCompactionOnlyContent(TOOL_RESULT_COMPACTION_NOTICE)).toBe(true);
    expect(
      isContextCompactionOnlyContent(
        `${MESSAGE_CONTENT_COMPACTION_NOTICE}\nContinued with the task.`
      )
    ).toBe(false);
    expect(
      stripContextCompactionNotices(
        `${MESSAGE_CONTENT_COMPACTION_NOTICE}\n\nContinued with the task.`
      )
    ).toBe("Continued with the task.");
  });

  test("recognizes xAI prompt-length overflow errors", () => {
    expect(
      isContextOverflowError(
        "API error in agentic loop: 400 - invalid argument: the model's maximum prompt length is 256000 but the request contains 286101 tokens"
      )
    ).toBe(true);
  });

  test("elides old OpenAI-compatible chat content without reordering messages", () => {
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: "system rules" },
      { role: "user", content: "review this repo" },
      { role: "assistant", content: "old analysis ".repeat(500) },
      { role: "tool", tool_call_id: "call-1", content: "tool output ".repeat(500) },
      { role: "user", content: "old steering ".repeat(500) },
      { role: "assistant", content: "recent summary" },
      { role: "user", content: "current question" },
    ];
    const rolesBefore = messages.map((message) => message.role);

    const elided = compactOpenAIChatTranscriptInPlace(messages, 900);

    expect(elided).toBeGreaterThan(0);
    expect(messages.map((message) => message.role)).toEqual(rolesBefore);
    expect(messages[0].content).toBe("system rules");
    expect(messages[1].content).toBe("review this repo");
    expect(messages[2].content).toBe(MESSAGE_CONTENT_COMPACTION_NOTICE);
    expect(messages[3].content).toBe(TOOL_RESULT_COMPACTION_NOTICE);
    expect(messages[5].content).toBe("recent summary");
    expect(messages[6].content).toBe("current question");
  });

  test("compacts large tool transcripts in linear time", () => {
    const messages: Array<Record<string, unknown>> = [];
    for (let index = 0; index < 400; index += 1) {
      messages.push({ role: "user", content: `question ${index}` });
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: Array.from({ length: 6 }, (_, callIndex) => ({
          id: `call-${index}-${callIndex}`,
          name: "edit",
          arguments: { path: "src/planner.py", content: "x".repeat(2000) },
        })),
      });
      for (let callIndex = 0; callIndex < 6; callIndex += 1) {
        messages.push({
          role: "tool",
          tool_call_id: `call-${index}-${callIndex}`,
          content: JSON.stringify({ success: true, diff: "y".repeat(3000) }),
        });
      }
    }
    messages.push({ role: "user", content: "current question" });

    const started = performance.now();
    const elided = compactOpenAIChatTranscriptInPlace(messages, 8000);
    const durationMs = performance.now() - started;

    expect(elided).toBeGreaterThan(100);
    expect(messages[messages.length - 1].content).toBe("current question");
    expect(durationMs).toBeLessThan(2000);
  });
});
