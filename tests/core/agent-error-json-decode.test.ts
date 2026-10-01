import { describe, expect, test } from "bun:test";
import { formatLlmFailure } from "../../src/core/agent-error-format";

const FRIEND_MESSAGE =
  "Provider rejected the request (400): Expecting value: line 1 column 2 (char 1)";

describe("upstream provider JSON decode failures", () => {
  test("explains the failure in plain language instead of a raw parser error", () => {
    const result = formatLlmFailure(FRIEND_MESSAGE);
    expect(result).toContain("could not decode");
    expect(result).toContain("send the message again");
    expect(result).not.toContain("Expecting value");
    expect(result).not.toContain("column 2");
  });

  test("reassures that nothing was lost and offers a new chat as the fallback", () => {
    const result = formatLlmFailure(FRIEND_MESSAGE);
    expect(result).toContain("Nothing was lost");
    expect(result).toContain("start a new chat");
  });

  test("leaves ordinary parameter rejections unchanged", () => {
    const result = formatLlmFailure(
      "Provider rejected the request (400): max_tokens is not supported for this model"
    );
    expect(result).toContain("max_tokens is not supported for this model");
    expect(result).not.toContain("could not decode");
  });

  test("still falls back to the generic guidance without a detail", () => {
    const result = formatLlmFailure("API error 400 - unsupported parameter");
    expect(result).toContain("Provider rejected the request (400)");
  });

  test("recognises other upstream decode phrasings", () => {
    for (const detail of [
      "Expecting value: line 1 column 1 (char 0)",
      "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)",
      "JSONDecodeError: Expecting value",
      "json.loads() failed",
      "Unexpected end of JSON input",
    ]) {
      expect(formatLlmFailure(`Provider rejected the request (400): ${detail}`)).toContain(
        "could not decode"
      );
    }
  });
});
