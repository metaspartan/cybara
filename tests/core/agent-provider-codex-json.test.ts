import { describe, expect, test } from "bun:test";
import { parseOpenAICodexJsonTurnResponse } from "../../src/core/openai-codex-response";

describe("OpenAI Codex JSON response parsing", () => {
  test("returns chat completion content, tool calls, and usage", () => {
    const result = parseOpenAICodexJsonTurnResponse({
      choices: [
        {
          message: {
            content: "done",
            tool_calls: [
              {
                id: "call-1|fc_item-1",
                function: { name: "read", arguments: '{"path":"README.md"}' },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 5 },
      },
    });
    expect(result).toMatchObject({
      content: "done",
      toolCalls: [
        {
          id: "call-1|fc_item-1",
          callId: "call-1",
          itemId: "fc_item-1",
          name: "read",
          args: { path: "README.md" },
        },
      ],
      usage: { inputTokens: 12, outputTokens: 4, cachedInputTokens: 5 },
    });
  });

  test("reports a redacted unexpected JSON payload instead of a consumed body error", () => {
    expect(() =>
      parseOpenAICodexJsonTurnResponse({
        error: { message: "upstream rejected request", token: "sk-secret-value" },
      })
    ).toThrow("Unexpected JSON response shape");
    try {
      parseOpenAICodexJsonTurnResponse({ authorization: "Bearer private-token" });
    } catch (error) {
      expect(String(error)).not.toContain("private-token");
      expect(String(error)).not.toContain("No response body");
    }
  });
});
