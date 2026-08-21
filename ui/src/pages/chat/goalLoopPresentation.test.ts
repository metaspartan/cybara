import { describe, expect, test } from "bun:test";
import { isVisibleChatTranscriptMessage } from "./goalLoopPresentation";

describe("goal loop transcript presentation", () => {
  test("hides system and autonomous continuation messages", () => {
    expect(isVisibleChatTranscriptMessage({ role: "system", content: "rules" })).toBe(false);
    expect(
      isVisibleChatTranscriptMessage({
        role: "user",
        content: "  [autonomous goal iteration 9]\nContinue working",
      })
    ).toBe(false);
  });

  test("keeps normal user and assistant messages visible", () => {
    expect(isVisibleChatTranscriptMessage({ role: "user", content: "Continue please" })).toBe(true);
    expect(isVisibleChatTranscriptMessage({ role: "assistant", content: "Working" })).toBe(true);
  });
});
