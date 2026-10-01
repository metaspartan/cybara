import { describe, expect, test } from "bun:test";
import { formatLlmFailure } from "../../src/core/agent-error-format";
import { markUnserializableToolCallArguments } from "../../src/core/llm/tool-call-argument-repair";

const VLLM_DETAIL = "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)";

function provider400(detail: string): string {
  return `Provider rejected the request (400): ${detail}`;
}

describe("upstream provider JSON decode failures", () => {
  test("blames a replayed tool call only when the request actually carried malformed arguments", () => {
    const error = markUnserializableToolCallArguments(new Error(provider400(VLLM_DETAIL)), 1);
    const result = formatLlmFailure(error);
    expect(result).toContain("1 tool call argument payload(s) replayed from earlier");
    expect(result).toContain("Nothing was lost");
    expect(result).toContain("start a new chat");
  });

  test("never discards the provider detail or the status code", () => {
    const error = markUnserializableToolCallArguments(new Error(provider400(VLLM_DETAIL)), 2);
    expect(formatLlmFailure(error)).toContain("Expecting property name enclosed in double quotes");
  });

  test("does not blame this conversation when no malformed tool call was sent", () => {
    const result = formatLlmFailure(provider400(VLLM_DETAIL));
    expect(result).not.toContain("replayed from earlier in this conversation");
    expect(result).toContain("provider-side decoding fault");
    expect(result).toContain("Expecting property name enclosed in double quotes");
  });

  test("leaves ordinary parameter rejections unchanged", () => {
    const result = formatLlmFailure(provider400("max_tokens is not supported for this model"));
    expect(result).toContain("max_tokens is not supported for this model");
    expect(result).not.toContain("could not decode");
  });

  test("still falls back to the generic guidance without a detail", () => {
    expect(formatLlmFailure("API error 400 - unsupported parameter")).toContain(
      "Provider rejected the request (400)"
    );
  });
});

describe("decode detection does not swallow unrelated 400s", () => {
  const UNRELATED: Array<[string, string]> = [
    ["openai request body unparseable", "We could not parse the JSON body of your request"],
    [
      "openai structured output schema",
      'Invalid JSON payload received. Unknown name "foo": Expected a value',
    ],
    ["anthropic malformed body", "invalid JSON: missing closing brace"],
    ["openai request too large", "Invalid JSON payload received due to truncation"],
    ["tool schema validation", "tools.0.function.parameters is not of type object"],
    ["tool choice unsupported", "tool_choice is not supported for this model"],
    ["context overflow", "maximum context length exceeded"],
  ];

  for (const [label, detail] of UNRELATED) {
    test(`preserves the provider message for ${label}`, () => {
      const result = formatLlmFailure(provider400(detail));
      expect(result).toContain(detail);
      expect(result).not.toContain("replayed from earlier in this conversation");
      expect(result).not.toContain("Nothing was lost");
    });
  }

  test("every unrelated case keeps the status code visible", () => {
    for (const [, detail] of UNRELATED) {
      expect(formatLlmFailure(provider400(detail))).toContain("(400)");
    }
  });
});

describe("genuine provider decode phrasings are still recognised", () => {
  for (const detail of [
    "Expecting value: line 1 column 1 (char 0)",
    "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)",
    "JSONDecodeError: Expecting value",
    "json.loads() failed",
    "Unexpected end of JSON input",
    "Expecting ',' delimiter: line 1 column 5 (char 4)",
  ]) {
    test(`recognises ${detail.slice(0, 34)}`, () => {
      expect(formatLlmFailure(provider400(detail))).toContain("could not decode");
    });
  }
});
