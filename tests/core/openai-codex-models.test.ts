import { describe, expect, test } from "bun:test";
import {
  extractOpenAICodexAccountId,
  getOpenAICodexModelCandidates,
  parseOpenAICodexModels,
  shouldRetryOpenAICodexModel,
} from "../../src/core/openai-codex-models";

function jwtWithAccount(accountId: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return (
    encode({ alg: "none" }) +
    "." +
    encode({
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }) +
    ".signature"
  );
}

describe("OpenAI Codex model availability", () => {
  test("extracts the ChatGPT account id used by model discovery", () => {
    expect(extractOpenAICodexAccountId(jwtWithAccount("account-56"))).toBe("account-56");
    expect(extractOpenAICodexAccountId("not-a-jwt")).toBeUndefined();
  });

  test("parses only visible picker models with account-specific limits", () => {
    expect(
      parseOpenAICodexModels({
        models: [
          {
            slug: "gpt-5.6-sol",
            display_name: "GPT-5.6-Sol",
            visibility: "list",
            show_in_picker: true,
            context_window: 352000,
            max_context_window: 372000,
            max_output_tokens: 128000,
            supported_reasoning_levels: [{ effort: "high" }],
            input_modalities: ["text", "image"],
          },
          {
            slug: "gpt-5.6-luna",
            visibility: "hide",
            show_in_picker: false,
          },
        ],
      })
    ).toEqual([
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6-Sol",
        contextWindow: 372000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
    ]);
  });

  test("recognizes the current 400 response and orders GPT-5.6 fallbacks", () => {
    expect(shouldRetryOpenAICodexModel(400, "Model not found gpt-5.6-luna")).toBe(true);
    expect(shouldRetryOpenAICodexModel(429, "Model not found gpt-5.6-luna")).toBe(false);
    expect(getOpenAICodexModelCandidates("gpt-5.6-luna")).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.5",
      "gpt-5.4",
    ]);
  });

  test("falls back from GPT-6 Astra to the GPT-5.6 flagship chain", () => {
    expect(getOpenAICodexModelCandidates("gpt-6-astra")).toEqual([
      "gpt-6-astra",
      "gpt-5.6-sol",
      "gpt-5.5",
      "gpt-5.4",
    ]);
  });
});
