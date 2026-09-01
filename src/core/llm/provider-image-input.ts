import type { AgentMessage } from "../agent";
import type { AgentImage } from "./image-blocks";
import { convertHeicWithEmbeddedDecoder } from "./heic-converter.js";
import { hasImages, MAX_INLINE_IMAGE_BYTES, normalizeMimeType, parseDataUri } from "./image-blocks";

type HeicConverter = (options: {
  buffer: Uint8Array;
  format: "JPEG";
  quality: number;
}) => Promise<Uint8Array>;

const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const OMITTED_IMAGE_TEXT =
  "[An attached image could not be decoded and was omitted. Ask the user to attach a valid PNG, JPEG, GIF, WebP, HEIC, or HEIF image.]";
const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);

interface ImageMetadata {
  mimeType: string;
  width: number;
  height: number;
}

function imagePayload(image: AgentImage): { data?: string; mimeType: string } {
  if (typeof image.data === "string" && image.data.length > 0) {
    const parsed = parseDataUri(image.data);
    return {
      data: parsed.data,
      mimeType: normalizeMimeType(image.mimeType || parsed.mimeType),
    };
  }
  if (typeof image.url === "string" && image.url.startsWith("data:")) {
    const parsed = parseDataUri(image.url);
    return {
      data: parsed.data,
      mimeType: normalizeMimeType(image.mimeType || parsed.mimeType),
    };
  }
  return { mimeType: normalizeMimeType(image.mimeType) };
}

function validDimensions(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_DIMENSION &&
    height <= MAX_IMAGE_DIMENSION &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

function readUint24LE(input: Buffer, offset: number): number {
  return input[offset]! | (input[offset + 1]! << 8) | (input[offset + 2]! << 16);
}

function pngMetadata(input: Buffer): ImageMetadata | undefined {
  const signature = "89504e470d0a1a0a";
  if (input.length < 33 || input.subarray(0, 8).toString("hex") !== signature) return undefined;
  if (input.subarray(12, 16).toString("ascii") !== "IHDR") return undefined;
  const width = input.readUInt32BE(16);
  const height = input.readUInt32BE(20);
  let offset = 8;
  let complete = false;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > input.length) return undefined;
    if (input.subarray(offset + 4, offset + 8).toString("ascii") === "IEND") {
      complete = length === 0;
      break;
    }
    offset = end;
  }
  return complete && validDimensions(width, height)
    ? { mimeType: "image/png", width, height }
    : undefined;
}

function jpegMetadata(input: Buffer): ImageMetadata | undefined {
  if (input.length < 12 || input[0] !== 0xff || input[1] !== 0xd8) return undefined;
  if (input[input.length - 2] !== 0xff || input[input.length - 1] !== 0xd9) return undefined;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= input.length) {
    while (input[offset] === 0xff) offset += 1;
    const marker = input[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > input.length) return undefined;
    const length = input.readUInt16BE(offset);
    if (length < 2 || offset + length > input.length) return undefined;
    if (startOfFrameMarkers.has(marker) && length >= 7) {
      const height = input.readUInt16BE(offset + 3);
      const width = input.readUInt16BE(offset + 5);
      return validDimensions(width, height) ? { mimeType: "image/jpeg", width, height } : undefined;
    }
    offset += length;
  }
  return undefined;
}

function gifMetadata(input: Buffer): ImageMetadata | undefined {
  const header = input.subarray(0, 6).toString("ascii");
  if (input.length < 14 || (header !== "GIF87a" && header !== "GIF89a")) return undefined;
  if (input[input.length - 1] !== 0x3b) return undefined;
  const width = input.readUInt16LE(6);
  const height = input.readUInt16LE(8);
  return validDimensions(width, height) ? { mimeType: "image/gif", width, height } : undefined;
}

function webpMetadata(input: Buffer): ImageMetadata | undefined {
  if (
    input.length < 30 ||
    input.subarray(0, 4).toString("ascii") !== "RIFF" ||
    input.subarray(8, 12).toString("ascii") !== "WEBP" ||
    input.readUInt32LE(4) + 8 > input.length
  ) {
    return undefined;
  }
  const format = input.subarray(12, 16).toString("ascii");
  let width = 0;
  let height = 0;
  if (format === "VP8X") {
    width = readUint24LE(input, 24) + 1;
    height = readUint24LE(input, 27) + 1;
  } else if (format === "VP8L" && input[20] === 0x2f) {
    const bits = input.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (format === "VP8 " && input[23] === 0x9d && input[24] === 0x01 && input[25] === 0x2a) {
    width = input.readUInt16LE(26) & 0x3fff;
    height = input.readUInt16LE(28) & 0x3fff;
  }
  return validDimensions(width, height) ? { mimeType: "image/webp", width, height } : undefined;
}

function imageMetadata(input: Buffer): ImageMetadata | undefined {
  return pngMetadata(input) ?? jpegMetadata(input) ?? gifMetadata(input) ?? webpMetadata(input);
}

function hasHeicBrand(input: Buffer): boolean {
  if (input.length < 12 || input.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const boxSize = Math.min(input.readUInt32BE(0), input.length);
  if (boxSize < 12) return false;
  for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
    if (HEIC_BRANDS.has(input.subarray(offset, offset + 4).toString("ascii"))) return true;
  }
  return false;
}

async function defaultHeicConverter(options: {
  buffer: Uint8Array;
  format: "JPEG";
  quality: number;
}): Promise<Uint8Array> {
  return convertHeicWithEmbeddedDecoder(options);
}

export async function prepareAgentImageForProvider(
  image: AgentImage,
  convertHeic: HeicConverter = defaultHeicConverter
): Promise<AgentImage | undefined> {
  const normalizedImage = await normalizeHeicAgentImage(image, convertHeic);
  if (!normalizedImage) return undefined;
  const payload = imagePayload(normalizedImage);
  if (!payload.data) return image.url ? image : undefined;

  const input = Buffer.from(payload.data, "base64");
  if (input.length === 0 || input.length > MAX_INLINE_IMAGE_BYTES) return undefined;

  const metadata = imageMetadata(input);
  if (!metadata) return undefined;
  const data = input.toString("base64");
  return normalizedImage.data === data &&
    normalizeMimeType(normalizedImage.mimeType) === metadata.mimeType
    ? normalizedImage
    : { data, mimeType: metadata.mimeType };
}

export async function normalizeHeicAgentImage(
  image: AgentImage,
  convertHeic: HeicConverter = defaultHeicConverter
): Promise<AgentImage | undefined> {
  const payload = imagePayload(image);
  if (!payload.data) return image;
  const input = Buffer.from(payload.data, "base64");
  if (input.length === 0 || input.length > MAX_INLINE_IMAGE_BYTES) return undefined;
  if (!HEIC_MIME_TYPES.has(payload.mimeType) && !hasHeicBrand(input)) return image;
  try {
    const output = Buffer.from(await convertHeic({ buffer: input, format: "JPEG", quality: 0.9 }));
    if (output.length === 0 || output.length > MAX_INLINE_IMAGE_BYTES) return undefined;
    return { data: output.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return undefined;
  }
}

export async function prepareAgentMessagesForProvider(
  messages: AgentMessage[]
): Promise<AgentMessage[]> {
  let changed = false;
  const prepared: AgentMessage[] = [];

  for (const message of messages) {
    if (!hasImages(message.images)) {
      prepared.push(message);
      continue;
    }

    const images = (
      await Promise.all(message.images.map((image) => prepareAgentImageForProvider(image)))
    ).filter((image): image is AgentImage => image !== undefined);
    const omitted = message.images.length - images.length;
    if (omitted === 0 && images.every((image, index) => image === message.images?.[index])) {
      prepared.push(message);
      continue;
    }

    changed = true;
    const notice = omitted > 0 ? OMITTED_IMAGE_TEXT : "";
    prepared.push({
      ...message,
      content: notice
        ? `${message.content}${message.content ? "\n\n" : ""}${notice}`
        : message.content,
      ...(images.length > 0 ? { images } : { images: undefined }),
    });
  }

  return changed ? prepared : messages;
}
