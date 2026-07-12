import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { validateUrl } from "../../api/security";
import { cybaraDir } from "../paths";

interface SaveInboundMediaBase {
  channel: string;
  fileName?: string;
  contentType?: string;
}

interface SaveInboundMediaFromUrlInput extends SaveInboundMediaBase {
  url: string;
  headers?: Record<string, string>;
}

interface SaveInboundMediaFromBase64Input extends SaveInboundMediaBase {
  base64Data: string;
}

interface SavedInboundMedia {
  path: string;
  bytes: number;
  contentType?: string;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

const MEDIA_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/json": ".json",
};

function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

function sanitizeFileName(input: string): string {
  const base = path.basename(input).replace(/[^\w.-]+/g, "_");
  return base || "file";
}

function inferExtension(contentType?: string, fileName?: string): string {
  const nameExt = fileName ? path.extname(fileName).toLowerCase() : "";
  if (nameExt) {
    return nameExt;
  }

  const normalizedContentType = contentType?.split(";")[0].trim().toLowerCase() || "";
  if (normalizedContentType && MEDIA_EXTENSIONS[normalizedContentType]) {
    return MEDIA_EXTENSIONS[normalizedContentType];
  }

  if (normalizedContentType.includes("/")) {
    const guessed = normalizedContentType.split("/")[1].replace(/[^\w.+-]+/g, "");
    if (guessed) {
      return guessed.startsWith(".") ? guessed : `.${guessed}`;
    }
  }

  return ".bin";
}

function buildStoredFileName(input: SaveInboundMediaBase): string {
  const sanitized = sanitizeFileName(input.fileName || "file");
  const baseName = path.basename(sanitized, path.extname(sanitized));
  const extension = inferExtension(input.contentType, sanitized);
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${Date.now()}-${suffix}-${baseName}${extension}`;
}

function inboundMediaLimit(contentType?: string): number {
  return contentType?.toLowerCase().startsWith("image/") ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES;
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Media download exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Media download exceeds ${maxBytes} bytes`);
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function getInboundMediaRootDir(): string {
  return path.join(cybaraDir, "media", "inbound");
}

export function getChannelInboundMediaDir(channel: string): string {
  return path.join(getInboundMediaRootDir(), channel);
}

export async function saveInboundMediaFromUrl(
  input: SaveInboundMediaFromUrlInput
): Promise<SavedInboundMedia> {
  const urlValidation = await validateUrl(input.url);
  if (!urlValidation.valid) {
    throw new Error(`Validation error: media download blocked: ${urlValidation.error}`);
  }

  const response = await fetch(input.url, { headers: input.headers });
  if (!response.ok) {
    throw new Error(`Media download failed: HTTP ${response.status}`);
  }

  const contentType = input.contentType || response.headers.get("content-type") || undefined;
  const bytes = await readBoundedResponse(response, inboundMediaLimit(contentType));
  const channelDir = getChannelInboundMediaDir(input.channel);
  ensureDirectory(channelDir);

  const storedName = buildStoredFileName({
    channel: input.channel,
    fileName: input.fileName,
    contentType,
  });
  const storedPath = path.join(channelDir, storedName);
  writeFileSync(storedPath, bytes, { mode: 0o600 });

  return {
    path: storedPath,
    bytes: bytes.byteLength,
    contentType,
  };
}

export function saveInboundMediaFromBase64(
  input: SaveInboundMediaFromBase64Input
): SavedInboundMedia {
  const normalized = input.base64Data.includes(",")
    ? input.base64Data.slice(input.base64Data.indexOf(",") + 1)
    : input.base64Data;
  const buffer = Buffer.from(normalized, "base64");
  const maxBytes = inboundMediaLimit(input.contentType);
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Media upload exceeds ${maxBytes} bytes`);
  }
  const channelDir = getChannelInboundMediaDir(input.channel);
  ensureDirectory(channelDir);

  const storedName = buildStoredFileName({
    channel: input.channel,
    fileName: input.fileName,
    contentType: input.contentType,
  });
  const storedPath = path.join(channelDir, storedName);
  writeFileSync(storedPath, buffer, { mode: 0o600 });

  return {
    path: storedPath,
    bytes: buffer.byteLength,
    contentType: input.contentType,
  };
}
