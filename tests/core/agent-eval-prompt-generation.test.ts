import { describe, expect, test } from "bun:test";
import {
  datasetPromptAuthorMaxOutputTokens,
  generateDatasetPromptDraft,
  parseDatasetPromptDifficulty,
  parseDatasetPromptFocus,
  parseGeneratedDatasetPrompts,
  type DatasetPromptAuthorInput,
  type DatasetPromptAuthorMessage,
} from "../../src/core/agent-eval/prompt-generation";

const input: DatasetPromptAuthorInput = {
  authorAgentName: "Author",
  authorModel: "author-model",
  targetAgentName: "Teacher",
  targetModel: "teacher-model",
  targetToolProfile: "coding",
  objective: "Train careful repository debugging",
  focus: "coding",
  difficulty: "advanced",
  count: 3,
  toolsEnabled: true,
  seedPrompts: ["Find and verify a concurrency defect."],
};

describe("dataset prompt generation", () => {
  test("bounds the author response budget for small and large drafts", () => {
    expect(datasetPromptAuthorMaxOutputTokens(1)).toBe(4_096);
    expect(datasetPromptAuthorMaxOutputTokens(30)).toBe(5_760);
    expect(datasetPromptAuthorMaxOutputTokens(50)).toBe(8_192);
  });

  test("parses structured, fenced, and numbered model output", () => {
    expect(
      parseGeneratedDatasetPrompts(
        '```json\n{"prompts":["First prompt",{"prompt":"Second prompt"}]}\n```',
        5
      )
    ).toEqual(["First prompt", "Second prompt"]);
    expect(
      parseGeneratedDatasetPrompts(
        "Prompts:\n1. Inspect a failed migration.\n2) Repair and verify the rollback.",
        5
      )
    ).toEqual(["Inspect a failed migration.", "Repair and verify the rollback."]);
  });

  test("repairs short drafts without retaining duplicates", async () => {
    const calls: DatasetPromptAuthorMessage[][] = [];
    const responses = [
      '{"prompts":["Inspect the queue.","Fix the queue."]}',
      '{"prompts":["Inspect the queue.","Prove the queue remains bounded."]}',
    ];
    const prompts = await generateDatasetPromptDraft(input, async (messages) => {
      calls.push(messages);
      return responses[calls.length - 1] || "";
    });

    expect(prompts).toEqual([
      "Inspect the queue.",
      "Fix the queue.",
      "Prove the queue remains bounded.",
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]?.content).toContain("Target agent: Teacher");
    expect(calls[0]?.[1]?.content).toContain(
      "Dataset objective: Train careful repository debugging"
    );
    expect(calls[0]?.[1]?.content).toContain("without substituting another language");
    expect(calls[0]?.[1]?.content).toContain("Create exactly 3 new prompts");
    expect(calls[1]?.[1]?.content).toContain("Do not repeat these prompts");
  });

  test("falls back to safe prompt design defaults", () => {
    expect(parseDatasetPromptFocus("unknown")).toBe("mixed");
    expect(parseDatasetPromptDifficulty(null)).toBe("mixed");
    expect(parseDatasetPromptFocus("research")).toBe("research");
    expect(parseDatasetPromptDifficulty("expert")).toBe("expert");
  });
});
