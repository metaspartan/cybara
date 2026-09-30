import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  compressImageToJpeg,
  IMAGE_COMPRESSION_THRESHOLD_BYTES,
  shouldCompressImageBytes,
} from "../../src/core/llm/image-compression";
import { prepareAgentImageForProvider } from "../../src/core/llm/provider-image-input";

const scratch = join(tmpdir(), `cybara-image-compression-${crypto.randomUUID()}`);

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const noise = Buffer.alloc(width * height * 3);
  for (let index = 0; index < noise.length; index += 1) {
    noise[index] = (index * 37 + (index % 251) * 13) % 256;
  }
  return new Uint8Array(
    await sharp(noise, { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer()
  );
}

describe("image compression", () => {
  test("classifies payloads by the size threshold", () => {
    expect(shouldCompressImageBytes(IMAGE_COMPRESSION_THRESHOLD_BYTES)).toBe(false);
    expect(shouldCompressImageBytes(IMAGE_COMPRESSION_THRESHOLD_BYTES + 1)).toBe(true);
    expect(shouldCompressImageBytes(0)).toBe(false);
    expect(shouldCompressImageBytes(Number.NaN)).toBe(false);
    expect(shouldCompressImageBytes(1_000_000, 0)).toBe(false);
  });

  test("leaves already-small images alone", async () => {
    const small = await makePng(16, 16);
    expect(await compressImageToJpeg(new Uint8Array(small), { maxBytes: 1 })).toBeUndefined();
  });

  test("rejects corrupt bytes instead of throwing", async () => {
    const garbage = new Uint8Array(600 * 1024).fill(7);
    expect(await compressImageToJpeg(garbage)).toBeUndefined();
  });

  test("rejects empty input", async () => {
    expect(await compressImageToJpeg(new Uint8Array())).toBeUndefined();
  });

  test("shrinks a large noisy PNG and reports the saving", async () => {
    mkdirSync(scratch, { recursive: true });
    try {
      const png = await makePng(1920, 1080);
      const result = await compressImageToJpeg(png);
      expect(result).toBeDefined();
      if (!result) return;
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.compressedBytes).toBeLessThan(result.originalBytes);
      expect(result.data.length).toBeGreaterThan(0);
      const decoded = sharp(Buffer.from(result.data, "base64"));
      const info = await decoded.metadata();
      expect(info.format).toBe("jpeg");
      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("provider preparation returns JPEG for an oversized PNG and keeps small PNGs as PNG", async () => {
    const large = await makePng(1920, 1080);
    const largeResult = await prepareAgentImageForProvider({
      data: Buffer.from(large).toString("base64"),
      mimeType: "image/png",
    });
    expect(largeResult?.mimeType).toBe("image/jpeg");

    const small = await makePng(24, 24);
    const smallResult = await prepareAgentImageForProvider({
      data: Buffer.from(small).toString("base64"),
      mimeType: "image/png",
    });
    expect(smallResult?.mimeType).toBe("image/png");
  });
});
