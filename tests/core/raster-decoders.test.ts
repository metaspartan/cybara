import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import { encodePngRgba } from "../../src/core/llm/png-encoder";
import { convertRasterToPng, decodeBmp, decodeTiff } from "../../src/core/llm/raster-decoders";
import { tinyBmp, tinyTiff } from "../helpers/image-fixtures";

const pixels: Array<[number, number, number, number?]> = [
  [255, 0, 0, 255],
  [0, 255, 0, 128],
  [0, 0, 255, 255],
  [10, 20, 30, 0],
];
const expectedRgba = Uint8Array.from(pixels.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
const opaqueRgba = Uint8Array.from(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));

function decodePng(png: Buffer): { width: number; height: number; data: Uint8Array } {
  const parsed = PNG.sync.read(png);
  return { width: parsed.width, height: parsed.height, data: Uint8Array.from(parsed.data) };
}

describe("raster decoders", () => {
  test("png encoder output round-trips pixel-exactly through an independent decoder", () => {
    const png = encodePngRgba(expectedRgba, 2, 2);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(decodePng(png)).toEqual({ width: 2, height: 2, data: expectedRgba });
    expect(() => encodePngRgba(new Uint8Array(3), 2, 2)).toThrow();
  });

  test("decodes 24-bit bottom-up and 32-bit top-down BMPs", () => {
    expect(decodeBmp(tinyBmp(pixels, 2, 2))).toEqual({ width: 2, height: 2, rgba: opaqueRgba });
    expect(decodeBmp(tinyBmp(pixels, 2, 2, { bits: 32, topDown: true }))).toEqual({
      width: 2,
      height: 2,
      rgba: expectedRgba,
    });
    expect(decodeBmp(Buffer.from("not a bitmap"))).toBeUndefined();
  });

  test("decodes RGB and RGBA TIFFs through the tiff dependency", () => {
    expect(decodeTiff(tinyTiff(pixels, 2, 2))).toEqual({ width: 2, height: 2, rgba: opaqueRgba });
    expect(decodeTiff(tinyTiff(pixels, 2, 2, { alpha: true }))).toEqual({
      width: 2,
      height: 2,
      rgba: expectedRgba,
    });
    expect(decodeTiff(Buffer.from([0x49, 0x49, 0x2a, 0x00, 9, 9, 9, 9]))).toBeUndefined();
  });

  test("converts TIFF and BMP to PNG that other tools can read", () => {
    const fromTiff = convertRasterToPng(tinyTiff(pixels, 2, 2, { alpha: true }));
    const fromBmp = convertRasterToPng(tinyBmp(pixels, 2, 2, { bits: 32 }));
    expect(fromTiff && decodePng(fromTiff)).toEqual({ width: 2, height: 2, data: expectedRgba });
    expect(fromBmp && decodePng(fromBmp)).toEqual({ width: 2, height: 2, data: expectedRgba });
    expect(convertRasterToPng(Buffer.from("plain text"))).toBeUndefined();
  });
});
