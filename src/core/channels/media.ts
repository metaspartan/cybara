import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
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

export function getInboundMediaRootDir(): string {
  return path.join(cybaraDir, "media", "inbound");
}

export function getChannelInboundMediaDir(channel: string): string {
  return path.join(getInboundMediaRootDir(), channel);
}

export async function saveInboundMediaFromUrl(
  input: SaveInboundMediaFromUrlInput
): Promise<SavedInboundMedia> {
  const response = await fetch(input.url, { headers: input.headers });
  if (!response.ok) {
    throw new Error(`Media download failed: HTTP ${response.status}`);
  }

  const contentType = input.contentType || response.headers.get("content-type") || undefined;
  const bytes = new Uint8Array(await response.arrayBuffer());
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
