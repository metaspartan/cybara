import { describe, expect, test } from "bun:test";
import {
  countInlineImages,
  DEFAULT_MAX_INLINE_IMAGES,
  limitInlineImages,
  parseProviderInlineImageLimit,
} from "../../src/core/llm/inline-images";

const imageBlock = (name: string) => ({
  type: "image_url",
  image_url: { url: `data:image/png;base64,${name}` },
});

const followup = (...names: string[]) => ({
  role: "user",
  content: [{ type: "text", text: "Inspect the image." }, ...names.map(imageBlock)],
});

describe("inline image limits", () => {
  test("keeps the most recent images and replaces older ones with a note", () => {
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: "rules" },
      followup("a", "b", "c", "d"),
      { role: "assistant", content: "rendering again" },
      followup("e"),
      followup("f", "g", "h", "i"),
    ];
    expect(countInlineImages(messages)).toBe(9);
    expect(limitInlineImages(messages, 8)).toBe(1);
    expect(countInlineImages(messages)).toBe(8);
    const first = messages[1].content as Array<Record<string, unknown>>;
    expect(first[1].type).toBe("text");
    expect(String(first[1].text)).toContain("omitted");
    expect(first[2]).toEqual(imageBlock("b"));
    const last = messages[4].content as Array<Record<string, unknown>>;
    expect(last.slice(1)).toEqual(["f", "g", "h", "i"].map(imageBlock));
  });

  test("leaves requests within the limit untouched", () => {
    const messages: Array<Record<string, unknown>> = [followup("a", "b")];
    const before = JSON.stringify(messages);
    expect(limitInlineImages(messages, DEFAULT_MAX_INLINE_IMAGES)).toBe(0);
    expect(JSON.stringify(messages)).toBe(before);
  });

  test("parses provider image-limit rejections", () => {
    expect(
      parseProviderInlineImageLimit(
        "API error in agentic loop: 400 - At most 8 image(s) may be provided in one prompt."
      )
    ).toBe(8);
    expect(parseProviderInlineImageLimit("context window exceeded")).toBeUndefined();
  });
});
