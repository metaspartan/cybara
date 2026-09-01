import { apiFetch, withGatewayBasePath } from "@/lib/auth";
import {
  loadAuthenticatedMediaSource,
  type LoadedAuthenticatedMediaSource,
  requiresAuthenticatedMediaFetch,
} from "@/lib/authenticatedMedia";
import type { ChatImageAttachment } from "@/types";

export const MAX_CHAT_IMAGES = 8;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|heic|heif)$/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|heic|heif)$/i;
const HEIC_IMAGE_MIME = /^image\/hei[cf](?:-sequence)?$/i;
const HEIC_IMAGE_EXTENSION = /\.hei[cf]$/i;

export function isSupportedImageType(mimeType: string, fileName = ""): boolean {
  return SUPPORTED_IMAGE_MIME.test(mimeType) || IMAGE_EXTENSION.test(fileName);
}

export function isHeicImage(
  image: Pick<ChatImageAttachment, "mimeType" | "name" | "path">
): boolean {
  return (
    HEIC_IMAGE_MIME.test(image.mimeType || "") ||
    HEIC_IMAGE_EXTENSION.test(image.name || "") ||
    HEIC_IMAGE_EXTENSION.test(image.path || "")
  );
}

export async function fileToChatImage(file: File): Promise<ChatImageAttachment> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
  }
  return {
    data: btoa(binary),
    mimeType: file.type || (HEIC_IMAGE_EXTENSION.test(file.name) ? "image/heic" : "image/png"),
    name: file.name,
    size: file.size,
  };
}

export function chatImageSrc(image: ChatImageAttachment): string {
  if (image.data) return `data:${image.mimeType || "image/png"};base64,${image.data}`;
  if (image.path) return withGatewayBasePath(`/api/media?path=${encodeURIComponent(image.path)}`);
  return image.url || "";
}

export function screenshotMediaSrc(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() || "";
  if (!base) return "";
  return withGatewayBasePath(`/api/media?path=${encodeURIComponent(`screenshots/${base}`)}`);
}

export function chatMarkdownImageSrc(source: string): string | null {
  if (/^(https?:|data:image\/)/i.test(source)) return source;
  if (source.startsWith("/") && source.includes("/api/media?path=")) return source;
  if (!source.toLowerCase().startsWith("file://")) return null;
  try {
    const path = decodeURIComponent(new URL(source).pathname);
    if (!/\/screenshots\/[^/]+$/i.test(path) || !IMAGE_EXTENSION.test(path)) return null;
    return screenshotMediaSrc(path);
  } catch {
    return null;
  }
}

export type LoadedChatImageSource = LoadedAuthenticatedMediaSource;

export function requiresAuthenticatedImageFetch(source: string): boolean {
  return requiresAuthenticatedMediaFetch(source);
}

export async function loadChatImageSource(
  source: string,
  fetcher: typeof apiFetch = apiFetch,
  createObjectUrl: (blob: Blob) => string = URL.createObjectURL,
  revokeObjectUrl: (url: string) => void = URL.revokeObjectURL
): Promise<LoadedChatImageSource> {
  return loadAuthenticatedMediaSource(
    source,
    "image/",
    fetcher,
    createObjectUrl,
    revokeObjectUrl,
    "Image"
  );
}

export function chatMarkdownImageSources(content: string): string[] {
  const sources: string[] = [];
  const seenSources = new Set<string>();
  const pattern = /!\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^"'\n]*["'])?\s*\)/g;
  for (const match of content.matchAll(pattern)) {
    const source = chatMarkdownImageSrc(match[1] || match[2] || "");
    if (!source || seenSources.has(source)) continue;
    seenSources.add(source);
    sources.push(source);
  }
  return sources;
}

export const MAX_TEXT_FILE_BYTES = 256 * 1024;
export const MAX_TEXT_FILES = 10;

const TEXT_LIKE_EXTENSION =
  /\.(txt|md|markdown|json|jsonc|csv|tsv|xml|ya?ml|toml|ini|cfg|conf|log|html?|css|scss|jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cc|cs|php|sh|bash|zsh|sql|env|gitignore|dockerfile|vue|svelte)$/i;

export interface ChatFileAttachment {
  name: string;
  content: string;
  size?: number;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function imageAttachmentBytes(image: ChatImageAttachment): number {
  if (typeof image.size === "number") return image.size;
  if (image.data) return Math.floor((image.data.length * 3) / 4);
  return 0;
}

export function mediaSummaryLabel(
  images: ChatImageAttachment[],
  files: ChatFileAttachment[]
): string {
  const parts: string[] = [];
  if (images.length) parts.push(`${images.length} image${images.length === 1 ? "" : "s"}`);
  if (files.length) parts.push(`${files.length} file${files.length === 1 ? "" : "s"}`);
  const totalBytes =
    images.reduce((sum, image) => sum + imageAttachmentBytes(image), 0) +
    files.reduce((sum, file) => sum + (file.size || 0), 0);
  const size = formatBytes(totalBytes);
  return size ? `${parts.join(" · ")} · ${size}` : parts.join(" · ");
}

export function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (/(json|xml|yaml|x-yaml|javascript|typescript|csv|markdown)/i.test(file.type)) return true;
  return TEXT_LIKE_EXTENSION.test(file.name);
}

export async function fileToTextAttachment(file: File): Promise<ChatFileAttachment> {
  return { name: file.name, content: await file.text(), size: file.size };
}

export function formatAttachedFiles(text: string, files: ChatFileAttachment[]): string {
  if (files.length === 0) return text;
  const blocks = files
    .map((file) => `Attached file \`${file.name}\`:\n\`\`\`\n${file.content}\n\`\`\``)
    .join("\n\n");
  return text ? `${text}\n\n${blocks}` : blocks;
}

export function imageToolResultSrc(result: unknown): string | null {
  if (typeof result === "string" && result.trim().startsWith("{")) {
    try {
      return imageToolResultSrc(JSON.parse(result));
    } catch {
      return null;
    }
  }
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const filePath = typeof record.filePath === "string" ? record.filePath : "";
  const contentType = typeof record.contentType === "string" ? record.contentType : "";
  const isImage = /^image\//i.test(contentType) || IMAGE_EXTENSION.test(filePath);
  if (filePath && isImage) return screenshotMediaSrc(filePath);
  return null;
}

export function toolOutputImageSources(
  toolCalls: Array<{ result?: unknown }>,
  markdownContent: string
): string[] {
  const embeddedImages = new Set(chatMarkdownImageSources(markdownContent));
  return Array.from(
    new Set(
      toolCalls
        .map((toolCall) => imageToolResultSrc(toolCall.result))
        .filter((source): source is string => !!source && !embeddedImages.has(source))
    )
  );
}
