import type { ChatImageAttachment } from "@/types";
import { appendApiTokenParam } from "@/lib/auth";

export const MAX_CHAT_IMAGES = 8;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i;

export function isSupportedImageType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_MIME.test(mimeType);
}

export async function fileToChatImage(file: File): Promise<ChatImageAttachment> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
  }
  return { data: btoa(binary), mimeType: file.type || "image/png" };
}

export function chatImageSrc(image: ChatImageAttachment): string {
  if (image.data) return `data:${image.mimeType || "image/png"};base64,${image.data}`;
  if (image.path) return appendApiTokenParam(`/api/media?path=${encodeURIComponent(image.path)}`);
  return image.url || "";
}

export function screenshotMediaSrc(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() || "";
  if (!base) return "";
  return appendApiTokenParam(`/api/media?path=${encodeURIComponent(`screenshots/${base}`)}`);
}

export const MAX_TEXT_FILE_BYTES = 256 * 1024;
export const MAX_TEXT_FILES = 10;

const TEXT_LIKE_EXTENSION =
  /\.(txt|md|markdown|json|jsonc|csv|tsv|xml|ya?ml|toml|ini|cfg|conf|log|html?|css|scss|jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cc|cs|php|sh|bash|zsh|sql|env|gitignore|dockerfile|vue|svelte)$/i;

export interface ChatFileAttachment {
  name: string;
  content: string;
}

export function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (/(json|xml|yaml|x-yaml|javascript|typescript|csv|markdown)/i.test(file.type)) return true;
  return TEXT_LIKE_EXTENSION.test(file.name);
}

export async function fileToTextAttachment(file: File): Promise<ChatFileAttachment> {
  return { name: file.name, content: await file.text() };
}

export function formatAttachedFiles(text: string, files: ChatFileAttachment[]): string {
  if (files.length === 0) return text;
  const blocks = files
    .map((file) => `Attached file \`${file.name}\`:\n\`\`\`\n${file.content}\n\`\`\``)
    .join("\n\n");
  return text ? `${text}\n\n${blocks}` : blocks;
}

export function imageToolResultSrc(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const filePath = typeof record.filePath === "string" ? record.filePath : "";
  const contentType = typeof record.contentType === "string" ? record.contentType : "";
  const isImage = /^image\//i.test(contentType) || IMAGE_EXTENSION.test(filePath);
  if (filePath && isImage) return screenshotMediaSrc(filePath);
  return null;
}
