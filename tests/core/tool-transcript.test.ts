import { describe, expect, test } from "bun:test";
import {
  MESSAGE_CONTENT_COMPACTION_NOTICE,
  TOOL_RESULT_COMPACTION_NOTICE,
  compactOpenAIChatTranscriptInPlace,
  isContextOverflowError,
} from "../../src/core/llm/tool-transcript";

describe("LLM tool transcript compaction", () => {
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
});
