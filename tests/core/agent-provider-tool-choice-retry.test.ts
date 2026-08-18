import { describe, expect, test } from "bun:test";
import { formatLlmFailure } from "../../src/core/agent-error-format";
import {
  shouldRetryByRemovingToolChoice,
  toNoToolChoiceRequestBody,
} from "../../src/core/llm/tool-choice-compat";
const thinkingRejection =
  '{"error":{"message":"The request is invalid: Thinking mode does not support this tool_choice. Please check the request body, required fields, and request format.","code":"500"}}';
const bodyWithAuto = {
  model: "m",
  messages: [],
  tools: [{ type: "function" }],
  tool_choice: "auto",
};
const bodyWithForced = {
  model: "m",
  messages: [],
  tool_choice: { type: "function", function: { name: "read" } },
};

describe("thinking-mode tool_choice retry", () => {
  test("retries a 500 thinking-mode tool_choice rejection", () => {
    expect(shouldRetryByRemovingToolChoice(500, thinkingRejection, bodyWithAuto)).toBe(true);
  });

  test("retries a 400 thinking-mode tool_choice rejection", () => {
    expect(shouldRetryByRemovingToolChoice(400, thinkingRejection, bodyWithAuto)).toBe(true);
  });

  test("matches forced tool_choice objects too", () => {
    expect(shouldRetryByRemovingToolChoice(500, thinkingRejection, bodyWithForced)).toBe(true);
  });

  test("does not retry when tool_choice is absent", () => {
    expect(
      shouldRetryByRemovingToolChoice(500, thinkingRejection, { model: "m", messages: [] })
    ).toBe(false);
  });

  test("does not retry unrelated errors", () => {
    expect(shouldRetryByRemovingToolChoice(500, "internal server error", bodyWithAuto)).toBe(false);
    expect(shouldRetryByRemovingToolChoice(429, thinkingRejection, bodyWithAuto)).toBe(false);
  });

  test("does not match when the error is not about thinking/reasoning", () => {
    expect(
      shouldRetryByRemovingToolChoice(
        400,
        '{"error":{"message":"tool_choice is not allowed here"}}',
        bodyWithAuto
      )
    ).toBe(false);
  });

  test("toNoToolChoiceRequestBody removes tool_choice and keeps tools", () => {
    const next = toNoToolChoiceRequestBody(bodyWithAuto);
    expect(next.tool_choice).toBeUndefined();
    expect(next.tools).toBeDefined();
    expect(next.model).toBe("m");
  });
});

describe("provider error status formatting", () => {
  test("uses the real status from API error prefix instead of assuming 400", () => {
    const formatted = formatLlmFailure(
      new Error(`API error in agentic loop: 500 - ${thinkingRejection}`)
    );
    expect(formatted).toContain("Provider rejected the request (500)");
    expect(formatted).toContain("Thinking mode does not support this tool_choice");
  });

  test("keeps 400 formatting for genuine 400 errors", () => {
    expect(
      formatLlmFailure(new Error('API error: 400 - {"error":{"message":"bad request"}}'))
    ).toBe("Provider rejected the request (400): bad request");
  });
});
