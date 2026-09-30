import { describe, expect, test } from "bun:test";
import {
  validateDecisionBatch,
  validateDecisionQuestion,
} from "../../src/core/decisions/validation";

function choiceWith(options: unknown): unknown {
  return { type: "choice", instructions: "Which team owns the fix?", options };
}

describe("decision choice option normalization", () => {
  test("accepts a plain array unchanged", () => {
    const result = validateDecisionQuestion(choiceWith(["platform", "ci-infra"]));
    expect(result).toEqual({
      type: "choice",
      instructions: "Which team owns the fix?",
      options: ["platform", "ci-infra"],
    });
  });

  test("unwraps a single item wrapper", () => {
    const result = validateDecisionQuestion(choiceWith({ item: ["platform", "ci-infra"] }));
    expect(result).toEqual({
      type: "choice",
      instructions: "Which team owns the fix?",
      options: ["platform", "ci-infra"],
    });
  });

  test("unwraps the nested item wrapper a model actually emitted", () => {
    const emitted = { item: { item: ["platform", { item: "ci-infra" }] } };
    const result = validateDecisionQuestion(choiceWith(emitted));
    expect(result).toEqual({
      type: "choice",
      instructions: "Which team owns the fix?",
      options: ["platform", "ci-infra"],
    });
  });

  test("flattens a nested array", () => {
    const result = validateDecisionQuestion(choiceWith([["platform"], ["ci-infra", "app-team"]]));
    expect(result).toEqual({
      type: "choice",
      instructions: "Which team owns the fix?",
      options: ["platform", "ci-infra", "app-team"],
    });
  });

  test("still rejects a genuine single option", () => {
    expect(typeof validateDecisionQuestion(choiceWith({ item: ["platform"] }))).toBe("string");
  });

  test("still rejects non-string options after unwrapping", () => {
    expect(typeof validateDecisionQuestion(choiceWith({ item: ["platform", 7] }))).toBe("string");
  });

  test("still rejects duplicates after normalization", () => {
    expect(typeof validateDecisionQuestion(choiceWith([["a"], ["a", "b"]]))).toBe("string");
  });

  test("rejects an unrelated object rather than guessing", () => {
    expect(typeof validateDecisionQuestion(choiceWith({ nope: true }))).toBe("string");
  });

  test("error names the expected shape", () => {
    const result = validateDecisionQuestion(choiceWith({ nope: true }));
    expect(String(result)).toContain("plain array of strings");
  });

  test("a wrapped choice question validates inside a full batch", () => {
    const batch = validateDecisionBatch({
      state: "evidence",
      questions: { q: { type: "choice", instructions: "pick", options: { item: ["a", "b"] } } },
    });
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.batch.questions.q).toEqual({
      type: "choice",
      instructions: "pick",
      options: ["a", "b"],
    });
  });
});
