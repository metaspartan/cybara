import { decode as decodeTiffPages } from "tiff";
import { encodePngRgba } from "./png-encoder";

export interface DecodedRaster {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const MAX_RASTER_SIDE = 8192;
const MAX_RASTER_PIXELS = 32 * 1024 * 1024;

function rasterDimensionsAllowed(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_RASTER_SIDE &&
    height <= MAX_RASTER_SIDE &&
    width * height <= MAX_RASTER_PIXELS
  );
}

export function isBmp(bytes: Uint8Array): boolean {
  return bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

export function isTiff(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a;
  return little || big;
}

export function decodeBmp(input: Uint8Array): DecodedRaster | undefined {
  if (!isBmp(input)) return undefined;
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const pixelOffset = bytes.readUInt32LE(10);
  const headerSize = bytes.readUInt32LE(14);
  if (headerSize < 40 || bytes.length < 14 + headerSize) return undefined;
  const width = bytes.readInt32LE(18);
  const rawHeight = bytes.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const bitCount = bytes.readUInt16LE(28);
  const compression = bytes.readUInt32LE(30);
  if (!rasterDimensionsAllowed(width, height)) return undefined;
  if ((bitCount !== 24 && bitCount !== 32) || (compression !== 0 && compression !== 3)) {
    return undefined;
  }
  const bytesPerPixel = bitCount / 8;
  const stride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  if (pixelOffset + stride * height > bytes.length) return undefined;
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = rawHeight > 0 ? height - 1 - row : row;
    const rowStart = pixelOffset + sourceRow * stride;
    for (let column = 0; column < width; column += 1) {
      const source = rowStart + column * bytesPerPixel;
      const target = (row * width + column) * 4;
      rgba[target] = bytes[source + 2] as number;
      rgba[target + 1] = bytes[source + 1] as number;
      rgba[target + 2] = bytes[source] as number;
      rgba[target + 3] = bitCount === 32 ? (bytes[source + 3] as number) : 255;
    }
  }
  return { width, height, rgba };
}

function sampleToByte(value: number, bitsPerSample: number): number {
  if (bitsPerSample === 16) return value >>> 8;
  if (bitsPerSample === 8) return value;
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function decodeTiff(input: Uint8Array): DecodedRaster | undefined {
  if (!isTiff(input)) return undefined;
  let page: ReturnType<typeof decodeTiffPages>[number] | undefined;
  try {
    page = decodeTiffPages(input, { pages: [0] })[0];
  } catch {
    return undefined;
  }
  if (!page) return undefined;
  const { width, height, components, bitsPerSample, alpha, palette, data } = page;
  if (!rasterDimensionsAllowed(width, height)) return undefined;
  if (bitsPerSample !== 8 && bitsPerSample !== 16) return undefined;
  if (data.length < width * height * components) return undefined;
  const rgba = new Uint8Array(width * height * 4);
  const colorChannels = alpha ? components - 1 : components;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * components;
    const target = pixel * 4;
    if (palette && components === 1) {
      const entry = palette[data[source] as number];
      rgba[target] = entry ? sampleToByte(entry[0], 16) : 0;
      rgba[target + 1] = entry ? sampleToByte(entry[1], 16) : 0;
      rgba[target + 2] = entry ? sampleToByte(entry[2], 16) : 0;
      rgba[target + 3] = 255;
      continue;
    }
    if (colorChannels === 1) {
      const gray = sampleToByte(data[source] as number, bitsPerSample);
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
    } else if (colorChannels >= 3) {
      rgba[target] = sampleToByte(data[source] as number, bitsPerSample);
      rgba[target + 1] = sampleToByte(data[source + 1] as number, bitsPerSample);
      rgba[target + 2] = sampleToByte(data[source + 2] as number, bitsPerSample);
    } else {
      return undefined;
    }
    rgba[target + 3] = alpha
      ? sampleToByte(data[source + colorChannels] as number, bitsPerSample)
      : 255;
  }
  return { width, height, rgba };
}

export function decodeRaster(input: Uint8Array): DecodedRaster | undefined {
  return decodeTiff(input) ?? decodeBmp(input);
}

export function convertRasterToPng(input: Uint8Array): Buffer | undefined {
  const raster = decodeRaster(input);
  return raster ? encodePngRgba(raster.rgba, raster.width, raster.height) : undefined;
}
