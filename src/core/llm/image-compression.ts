const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 384 * 1024;
const DEFAULT_COMPRESSION_QUALITY = 82;
const MIN_DIMENSION = 64;

export interface ImageCompressionOptions {
  maxBytes?: number;
  quality?: number;
}

export interface JpegCompressionResult {
  data: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  originalBytes: number;
  compressedBytes: number;
}

interface SharpPipeline {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  jpeg(options: { quality: number; mozjpeg?: boolean }): SharpPipeline;
  resize(options: {
    width?: number;
    height?: number;
    fit: "inside";
    withoutEnlargement: boolean;
  }): SharpPipeline;
  toBuffer(): Promise<Buffer>;
}

async function loadSharp(): Promise<((input: Uint8Array) => SharpPipeline) | undefined> {
  try {
    const imported = (await import("sharp")) as unknown as {
      default?: (input: Uint8Array) => SharpPipeline;
    };
    return typeof imported.default === "function" ? imported.default : undefined;
  } catch {
    return undefined;
  }
}

export function shouldCompressImageBytes(
  byteLength: number,
  maxBytes = DEFAULT_COMPRESSION_THRESHOLD_BYTES
): boolean {
  return Number.isFinite(byteLength) && byteLength > maxBytes && maxBytes > 0;
}

export async function compressImageToJpeg(
  input: Uint8Array,
  options: ImageCompressionOptions = {}
): Promise<JpegCompressionResult | undefined> {
  const quality = options.quality ?? DEFAULT_COMPRESSION_QUALITY;
  const maxBytes = options.maxBytes ?? DEFAULT_COMPRESSION_THRESHOLD_BYTES;
  if (input.length === 0 || !shouldCompressImageBytes(input.length, maxBytes)) return undefined;

  const sharpFactory = await loadSharp();
  if (!sharpFactory) return undefined;

  try {
    const pipeline = sharpFactory(input);
    const metadata = await pipeline.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) return undefined;

    const output = await pipeline
      .resize({ fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (output.length === 0 || output.length >= input.length) return undefined;

    return {
      data: output.toString("base64"),
      mimeType: "image/jpeg",
      width: Math.min(width, metadata.width ?? width),
      height,
      originalBytes: input.length,
      compressedBytes: output.length,
    };
  } catch {
    return undefined;
  }
}

export const IMAGE_COMPRESSION_THRESHOLD_BYTES = DEFAULT_COMPRESSION_THRESHOLD_BYTES;
