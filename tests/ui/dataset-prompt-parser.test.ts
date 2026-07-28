import { describe, expect, test } from "bun:test";
import {
  formatDatasetPromptsForEditor,
  parseDatasetPrompts,
} from "../../ui/src/pages/research/datasetPromptParser";

describe("dataset prompt parser", () => {
  test("accepts text, prompt JSONL, and conversational JSONL", () => {
    const prompts = parseDatasetPrompts(
      [
        "Explain sparse attention.",
        JSON.stringify({ prompt: "Write a worker queue." }),
        JSON.stringify({ instruction: "Grade this proof." }),
        JSON.stringify({
          messages: [
            { role: "assistant", content: "Earlier" },
            { role: "user", content: "Continue the analysis." },
          ],
        }),
      ].join("\n")
    );
    expect(prompts).toEqual([
      "Explain sparse attention.",
      "Write a worker queue.",
      "Grade this proof.",
      "Continue the analysis.",
    ]);
  });

  test("keeps malformed JSONL as a literal prompt and removes blank lines", () => {
    expect(parseDatasetPrompts('\n{"prompt":\n\nhello\n')).toEqual(['{"prompt":', "hello"]);
  });

  test("preserves multiline generated prompts through the editable JSONL form", () => {
    const source = formatDatasetPromptsForEditor([
      "Review this service.",
      "Implement the function:\nfunction run(): void {}",
    ]);
    expect(parseDatasetPrompts(source)).toEqual([
      "Review this service.",
      "Implement the function:\nfunction run(): void {}",
    ]);
  });
});
