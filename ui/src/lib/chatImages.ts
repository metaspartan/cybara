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
  return image.url || "";
}

export function screenshotMediaSrc(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() || "";
  if (!base) return "";
  return appendApiTokenParam(`/api/media?path=${encodeURIComponent(`screenshots/${base}`)}`);
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
