import { describe, expect, test } from "bun:test";
import {
  estimateOpenAIRequestTokens,
  estimateRequestValueChars,
  IMAGE_TOKEN_ESTIMATE,
  isImageContentBlock,
} from "../../src/core/llm/context-estimate";
import { CONTEXT_CHARS_PER_TOKEN_ESTIMATE } from "../../src/core/agent-internals";

const base64Image = (chars: number) => `data:image/png;base64,${"a".repeat(chars)}`;

describe("request context estimation", () => {
  test("recognizes every provider image block shape", () => {
    expect(isImageContentBlock({ type: "image", source: { type: "base64", data: "x" } })).toBe(
      true
    );
    expect(isImageContentBlock({ type: "image_url", image_url: { url: "x" } })).toBe(true);
    expect(isImageContentBlock({ type: "input_image", image_url: "x" })).toBe(true);
    expect(isImageContentBlock({ type: "text", text: "x" })).toBe(false);
    expect(isImageContentBlock("image")).toBe(false);
  });

  test("charges images by visual tokens instead of base64 length", () => {
    const block = { type: "image_url", image_url: { url: base64Image(2_000_000) } };
    expect(estimateRequestValueChars(block)).toBe(
      IMAGE_TOKEN_ESTIMATE * CONTEXT_CHARS_PER_TOKEN_ESTIMATE
    );
  });

  test("keeps four large image tool follow-ups within a one-million-token window", () => {
    const followup = {
      role: "user",
      content: [
        { type: "text", text: "Inspect the image returned by the file or image tool." },
        { type: "image_url", image_url: { url: base64Image(1_730_000) } },
        { type: "image_url", image_url: { url: base64Image(1_730_000) } },
      ],
    };
    const request = {
      model: "vision-model",
      messages: [
        { role: "system", content: "s".repeat(40_000) },
        { role: "user", content: "render it" },
        followup,
        { role: "assistant", content: "rendering again" },
        followup,
      ],
    };
    const estimate = estimateOpenAIRequestTokens(request);
    expect(estimate).toBeLessThan(40_000);
    expect(estimate).toBeGreaterThan(4 * IMAGE_TOKEN_ESTIMATE);
  });

  test("still counts text content by length", () => {
    const estimate = estimateOpenAIRequestTokens({
      messages: [{ role: "user", content: "x".repeat(4_000) }],
    });
    expect(estimate).toBeGreaterThanOrEqual(1_000);
    expect(estimate).toBeLessThan(1_100);
  });
});
