import {
  type ChatFileAttachment,
  MAX_CHAT_IMAGE_BYTES,
  MAX_TEXT_FILE_BYTES,
  fileToChatImage,
  fileToTextAttachment,
  isSupportedImageType,
  isTextLikeFile,
} from "./chatImages";
import type { ChatImageAttachment } from "@/types";

export type AttachmentFileResult =
  | { kind: "image"; value: ChatImageAttachment }
  | { kind: "text"; value: ChatFileAttachment }
  | { kind: "oversized"; name: string }
  | { kind: "unsupported"; name: string };

export function hasAttachableFiles(files: Iterable<File>): boolean {
  return Array.from(files).some(
    (file) => isSupportedImageType(file.type, file.name) || isTextLikeFile(file)
  );
}

export function imageFilesFromTransfer(files: Iterable<File>): File[] {
  return Array.from(files).filter((file) => isSupportedImageType(file.type, file.name));
}

export async function readAttachmentFile(file: File): Promise<AttachmentFileResult> {
  if (isSupportedImageType(file.type, file.name)) {
    if (file.size > MAX_CHAT_IMAGE_BYTES) return { kind: "oversized", name: file.name };
    return { kind: "image", value: await fileToChatImage(file) };
  }
  if (isTextLikeFile(file)) {
    if (file.size > MAX_TEXT_FILE_BYTES) return { kind: "oversized", name: file.name };
    return { kind: "text", value: await fileToTextAttachment(file) };
  }
  return { kind: "unsupported", name: file.name };
}
