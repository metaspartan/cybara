import { describe, expect, test } from "bun:test";
import { parseGoalJudgeVerdict } from "../../src/api/chat-goal-judge";

describe("goal completion judge parsing", () => {
  test("accepts strict done and continue verdicts", () => {
    expect(parseGoalJudgeVerdict('{"verdict":"done","reason":"Verified output"}')).toEqual({
      verdict: "done",
      reason: "Verified output",
    });
    expect(parseGoalJudgeVerdict('{"verdict":"continue","reason":"More work remains"}')).toEqual({
      verdict: "continue",
      reason: "More work remains",
    });
  });

  test("accepts fenced JSON and rejects malformed or unknown verdicts", () => {
    expect(parseGoalJudgeVerdict('```json\n{"verdict":"done","reason":"Complete"}\n```')).toEqual({
      verdict: "done",
      reason: "Complete",
    });
    expect(parseGoalJudgeVerdict('{"verdict":"wait","reason":"Later"}')).toBeNull();
    expect(parseGoalJudgeVerdict("DONE")).toBeNull();
  });
});
