import { describe, expect, test } from "bun:test";
import {
  BOT_PROFILE_IMAGE_MAX_BYTES,
  normalizeBotProfileImage,
} from "../../shared/bot-profile-image";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function dataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function pngBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_SIGNATURE);
  return bytes;
}

describe("bot profile images", () => {
  test("accepts supported image data URLs and clearing the image", () => {
    const png = dataUrl("image/png", pngBytes(PNG_SIGNATURE.length));
    const jpeg = dataUrl("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]));
    const webp = dataUrl(
      "image/webp",
      Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    );

    expect(normalizeBotProfileImage(png)).toBe(png);
    expect(normalizeBotProfileImage(jpeg)).toBe(jpeg);
    expect(normalizeBotProfileImage(webp)).toBe(webp);
    expect(normalizeBotProfileImage("")).toBe("");
  });

  test("rejects unsupported, mislabeled, malformed, and remote image values", () => {
    expect(normalizeBotProfileImage("https://example.com/bot.png")).toBeNull();
    expect(normalizeBotProfileImage("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(normalizeBotProfileImage("data:image/png;base64,A===")).toBeNull();
    expect(
      normalizeBotProfileImage(dataUrl("image/png", Uint8Array.from([0xff, 0xd8, 0xff, 0xdb])))
    ).toBeNull();
  });

  test("accepts the byte limit and rejects the smallest value above it", () => {
    expect(
      normalizeBotProfileImage(dataUrl("image/png", pngBytes(BOT_PROFILE_IMAGE_MAX_BYTES)))
    ).toBeString();
    expect(
      normalizeBotProfileImage(dataUrl("image/png", pngBytes(BOT_PROFILE_IMAGE_MAX_BYTES + 1)))
    ).toBeNull();
  });
});
