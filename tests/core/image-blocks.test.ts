import { describe, expect, test } from "bun:test";
import {
  toAnthropicImageBlock,
  toOpenAIImageBlock,
  toGoogleImagePart,
  parseDataUri,
  normalizeMimeType,
  hasImages,
  sanitizeAgentImages,
} from "../../src/core/llm/image-blocks";

describe("image block builders", () => {
  test("anthropic base64 block", () => {
    expect(toAnthropicImageBlock({ data: "abc", mimeType: "image/png" })).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "abc" },
    });
  });

  test("anthropic falls back to png for unsupported mime", () => {
    const block = toAnthropicImageBlock({ data: "abc", mimeType: "image/svg+xml" }) as {
      source: { media_type: string };
    };
    expect(block.source.media_type).toBe("image/png");
  });

  test("anthropic url source when no data", () => {
    expect(toAnthropicImageBlock({ url: "https://x/y.png" })).toEqual({
      type: "image",
      source: { type: "url", url: "https://x/y.png" },
    });
  });

  test("openai data uri block", () => {
    expect(toOpenAIImageBlock({ data: "abc", mimeType: "image/jpeg" })).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,abc" },
    });
  });

  test("openai passes through remote url", () => {
    expect(toOpenAIImageBlock({ url: "https://x/y.png" })).toEqual({
      type: "image_url",
      image_url: { url: "https://x/y.png" },
    });
  });

  test("google inline part needs bytes; null for url-only", () => {
    expect(toGoogleImagePart({ data: "abc", mimeType: "image/png" })).toEqual({
      inlineData: { mimeType: "image/png", data: "abc" },
    });
    expect(toGoogleImagePart({ url: "https://x/y.png" })).toBeNull();
  });

  test("data: URI passed in the data field is split", () => {
    const block = toOpenAIImageBlock({ data: "data:image/gif;base64,Zm9v" }) as {
      image_url: { url: string };
    };
    expect(block.image_url.url).toBe("data:image/gif;base64,Zm9v");
    const g = toGoogleImagePart({ data: "data:image/gif;base64,Zm9v" }) as {
      inlineData: { mimeType: string; data: string };
    };
    expect(g.inlineData).toEqual({ mimeType: "image/gif", data: "Zm9v" });
  });

  test("parseDataUri + normalizeMimeType", () => {
    expect(parseDataUri("data:image/png;base64,QQ==")).toEqual({
      data: "QQ==",
      mimeType: "image/png",
    });
    expect(parseDataUri("plainbytes")).toEqual({ data: "plainbytes" });
    expect(normalizeMimeType("image/jpg")).toBe("image/jpeg");
    expect(normalizeMimeType(undefined)).toBe("image/png");
  });
});

describe("hasImages / sanitizeAgentImages", () => {
  test("hasImages", () => {
    expect(hasImages([{ data: "x" }])).toBe(true);
    expect(hasImages([{}])).toBe(false);
    expect(hasImages(undefined)).toBe(false);
  });

  test("caps count", () => {
    const many = Array.from({ length: 20 }, () => ({ data: "x" }));
    expect(sanitizeAgentImages(many, 8)).toHaveLength(8);
  });

  test("drops oversized inline payloads", () => {
    const big = "a".repeat(7_000_001);
    expect(sanitizeAgentImages([{ data: big }])).toHaveLength(0);
  });

  test("rejects non-http(s)/data URLs", () => {
    expect(sanitizeAgentImages([{ url: "file:///etc/passwd" }])).toHaveLength(0);
    expect(sanitizeAgentImages([{ url: "https://ok/x.png" }])).toHaveLength(1);
    expect(sanitizeAgentImages([{ url: "data:image/png;base64,QQ==" }])).toHaveLength(1);
  });

  test("ignores non-array / junk entries", () => {
    expect(sanitizeAgentImages("nope")).toEqual([]);
    expect(sanitizeAgentImages([null, 5, {}, { data: "ok" }])).toHaveLength(1);
  });
});
