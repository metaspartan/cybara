import { describe, expect, test } from "bun:test";
import { formatLlmFailure } from "../../src/core/agent-error-format";

const FRIEND_MESSAGE =
  "Provider rejected the request (400): expecting value: line 1 column 2 (char 1)";

describe("upstream provider JSON decode failures", () => {
  test("explains that the provider could not parse our own request", () => {
    const result = formatLlmFailure(FRIEND_MESSAGE);
    expect(result).toContain("provider-side decoding fault");
    expect(result).toContain("not a malformed tool call");
    expect(result).toContain("expecting value");
  });

  test("keeps the actionable hint about switching model or endpoint", () => {
    const result = formatLlmFailure(FRIEND_MESSAGE);
    expect(result).toContain("switch provider or model");
    expect(result).toContain("served by that endpoint");
  });

  test("leaves ordinary parameter rejections unchanged", () => {
    const result = formatLlmFailure(
      "Provider rejected the request (400): max_tokens is not supported for this model"
    );
    expect(result).toContain("max_tokens is not supported for this model");
    expect(result).not.toContain("provider-side decoding fault");
  });

  test("still falls back to the generic guidance without a detail", () => {
    const result = formatLlmFailure("API error 400 - unsupported parameter");
    expect(result).toContain("Provider rejected the request (400)");
  });

  test("recognises other upstream decode phrasings", () => {
    for (const detail of [
      "Expecting value: line 1 column 1 (char 0)",
      "JSONDecodeError: Expecting value",
      "json.loads() failed",
      "Invalid JSON payload received",
      "Unexpected end of JSON input",
    ]) {
      expect(formatLlmFailure(`Provider rejected the request (400): ${detail}`)).toContain(
        "provider-side decoding fault"
      );
    }
  });
});
