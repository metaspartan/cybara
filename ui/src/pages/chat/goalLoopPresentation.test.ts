import { describe, expect, test } from "bun:test";
import { goalIterationNumber, isVisibleChatTranscriptMessage } from "./goalLoopPresentation";

describe("goal loop transcript presentation", () => {
  test("hides system messages and keeps autonomous continuation boundaries", () => {
    expect(isVisibleChatTranscriptMessage({ role: "system", content: "rules" })).toBe(false);
    expect(
      isVisibleChatTranscriptMessage({
        role: "user",
        content: "  [autonomous goal iteration 9]\nContinue working",
      })
    ).toBe(true);
  });

  test("keeps normal user and assistant messages visible", () => {
    expect(isVisibleChatTranscriptMessage({ role: "user", content: "Continue please" })).toBe(true);
    expect(isVisibleChatTranscriptMessage({ role: "assistant", content: "Working" })).toBe(true);
  });

  test("extracts autonomous goal iteration numbers without classifying normal user messages", () => {
    expect(
      goalIterationNumber({
        role: "user",
        content: "  [autonomous goal iteration 19]\nContinue working",
      })
    ).toBe(19);
    expect(goalIterationNumber({ role: "user", content: "Continue please" })).toBeNull();
    expect(
      goalIterationNumber({ role: "assistant", content: "[autonomous goal iteration 2]" })
    ).toBeNull();
  });
});
