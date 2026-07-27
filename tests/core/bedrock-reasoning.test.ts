import { describe, expect, test } from "bun:test";
import {
  bedrockAnthropicReasoningFields,
  collectBedrockReasoningText,
} from "../../src/core/llm/bedrock-reasoning";

describe("Bedrock reasoning", () => {
  test("maps current Claude effort into Converse additional fields", () => {
    expect(bedrockAnthropicReasoningFields("anthropic.claude-sonnet-5", "max")).toEqual({
      thinking: { type: "adaptive" },
      output_config: { effort: "max" },
    });
  });

  test("does not send adaptive fields without an effort or for legacy models", () => {
    expect(bedrockAnthropicReasoningFields("anthropic.claude-sonnet-5", undefined)).toBeUndefined();
    expect(bedrockAnthropicReasoningFields("anthropic.claude-sonnet-4-5", "high")).toBeUndefined();
  });

  test("collects provider-visible reasoning without signatures or redacted content", () => {
    expect(
      collectBedrockReasoningText([
        { reasoningContent: { reasoningText: { text: " Inspect the workspace. " } } },
        { reasoningContent: {} },
        {},
      ])
    ).toEqual(["Inspect the workspace."]);
  });
});
