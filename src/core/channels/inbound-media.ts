import { existsSync, readFileSync, statSync } from "fs";
import { type AgentImage, MAX_INLINE_IMAGE_BYTES } from "../llm/image-blocks";
import type { MessageHandlerAttachmentInfo, MessageHandlerFileInfo } from "./types";

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i;
const TEXT_EXTENSION =
  /\.(txt|md|markdown|json|jsonc|csv|tsv|xml|ya?ml|toml|ini|cfg|conf|log|html?|css|scss|jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cc|cs|php|sh|bash|zsh|sql)$/i;
const MAX_TEXT_BYTES = 256 * 1024;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function channelFileIsImage(fileInfo?: Partial<MessageHandlerFileInfo>): boolean {
  if (!fileInfo?.hasFile) return false;
  const filePath = (fileInfo.filePath || "").trim();
  const fileType = (fileInfo.fileType || "").toLowerCase();
  return fileType.startsWith("image/") || IMAGE_EXTENSION.test(filePath);
}

function channelFiles(
  fileInfo?: Partial<MessageHandlerFileInfo>
): Partial<MessageHandlerAttachmentInfo>[] {
  if (!fileInfo?.hasFile) return [];
  if (Array.isArray(fileInfo.files) && fileInfo.files.length > 0) return fileInfo.files;
  return [fileInfo];
}

export function buildChannelImages(fileInfo?: Partial<MessageHandlerFileInfo>): AgentImage[] {
  const images: AgentImage[] = [];
  for (const file of channelFiles(fileInfo)) {
    if (!channelFileIsImage(file)) continue;
    const filePath = (file.filePath || "").trim();
    const fileType = (file.fileType || "").toLowerCase();
    if (!filePath) continue;
    if (isHttpUrl(filePath)) {
      images.push({ url: filePath, mimeType: fileType || undefined });
      continue;
    }
    try {
      if (!existsSync(filePath)) continue;
      const stats = statSync(filePath);
      if (stats.isDirectory() || stats.size > MAX_INLINE_IMAGE_BYTES) continue;
      images.push({
        data: readFileSync(filePath).toString("base64"),
        mimeType: fileType || "image/png",
      });
    } catch {}
  }
  return images;
}

export function inlineChannelTextFile(fileInfo?: Partial<MessageHandlerFileInfo>): string | null {
  if (!fileInfo?.hasFile) return null;
  const filePath = (fileInfo.filePath || "").trim();
  const fileType = (fileInfo.fileType || "").toLowerCase();
  if (!filePath || isHttpUrl(filePath) || channelFileIsImage(fileInfo)) return null;

  const isText =
    fileType.startsWith("text/") ||
    /(json|xml|yaml|x-yaml|csv|javascript|typescript|markdown)/.test(fileType) ||
    TEXT_EXTENSION.test(filePath);
  if (!isText) return null;

  try {
    if (!existsSync(filePath)) return null;
    const stats = statSync(filePath);
    if (stats.isDirectory() || stats.size > MAX_TEXT_BYTES) return null;
    const name = filePath.split(/[\\/]/).pop() || "file";
    const content = readFileSync(filePath, "utf-8");
    return `Attached file \`${name}\`:\n\`\`\`\n${content}\n\`\`\``;
  } catch {
    return null;
  }
}

export function buildChannelMessageWithFileContext(
  message: string,
  fileInfo?: Partial<MessageHandlerFileInfo>
): string {
  const parts: string[] = [];
  const normalizedMessage = message.trim();
  if (normalizedMessage) parts.push(normalizedMessage);
  for (const file of channelFiles(fileInfo)) {
    const placeholder = file.placeholder?.trim() || "";
    if (placeholder && !normalizedMessage.includes(placeholder)) parts.push(placeholder);
    const inlinedText = inlineChannelTextFile(file);
    if (inlinedText) {
      parts.push(inlinedText);
    } else if (!channelFileIsImage(file)) {
      if (file.fileType?.trim()) parts.push(`[File type: ${file.fileType.trim()}]`);
      const fileName = (file.filePath || "").trim().split(/[\\/]/).pop();
      if (fileName) parts.push(`[File attached: ${fileName}]`);
    }
  }

  return parts.join("\n\n");
}
