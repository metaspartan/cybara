import type { ClipboardEvent, DragEvent } from "react";
import { useCallback, useState } from "react";
import {
  type ChatFileAttachment,
  fileToChatImage,
  fileToTextAttachment,
  formatAttachedFiles,
  isSupportedImageType,
  isTextLikeFile,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGES,
  MAX_TEXT_FILE_BYTES,
  MAX_TEXT_FILES,
} from "@/lib/chatImages";
import { dataTransferHasFiles } from "@/lib/fileDrop";
import { useUIStore } from "@/stores/uiStore";
import type { ChatImageAttachment } from "@/types";

interface ConsumedChatAttachments {
  images: ChatImageAttachment[];
  message: string;
}

type AttachmentFileResult =
  | { kind: "image"; value: ChatImageAttachment }
  | { kind: "text"; value: ChatFileAttachment }
  | { kind: "oversized"; name: string }
  | { kind: "unsupported"; name: string };

interface UseChatAttachmentsResult {
  addAttachmentFiles: (files: Iterable<File>) => Promise<void>;
  consumeAttachments: (text: string) => ConsumedChatAttachments;
  handleComposerDrop: (event: DragEvent<HTMLElement>) => void;
  handleComposerPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  imageDragActive: boolean;
  pendingFiles: ChatFileAttachment[];
  pendingImages: ChatImageAttachment[];
  removePendingFile: (index: number) => void;
  removePendingImage: (index: number) => void;
  setImageDragActive: (active: boolean) => void;
}

function hasAttachableFiles(files: Iterable<File>): boolean {
  return Array.from(files).some(
    (file) => isSupportedImageType(file.type, file.name) || isTextLikeFile(file)
  );
}

async function readAttachmentFile(file: File): Promise<AttachmentFileResult> {
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

export function useChatAttachments(): UseChatAttachmentsResult {
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatFileAttachment[]>([]);
  const [imageDragActive, setImageDragActive] = useState(false);

  const addAttachmentFiles = useCallback(async (files: Iterable<File>): Promise<void> => {
    const images: ChatImageAttachment[] = [];
    const texts: ChatFileAttachment[] = [];
    const unsupported: string[] = [];
    const oversized: string[] = [];
    const results = await Promise.all(Array.from(files).map(readAttachmentFile));
    for (const result of results) {
      if (result.kind === "image") images.push(result.value);
      if (result.kind === "text") texts.push(result.value);
      if (result.kind === "oversized") oversized.push(result.name);
      if (result.kind === "unsupported") unsupported.push(result.name);
    }
    if (images.length > 0) {
      setPendingImages((previous) => [...previous, ...images].slice(0, MAX_CHAT_IMAGES));
    }
    if (texts.length > 0) {
      setPendingFiles((previous) => [...previous, ...texts].slice(0, MAX_TEXT_FILES));
    }
    if (oversized.length > 0) {
      useUIStore
        .getState()
        .addToast("error", `Too large to attach: ${oversized.slice(0, 3).join(", ")}`);
    }
    if (unsupported.length > 0) {
      useUIStore
        .getState()
        .addToast("error", `Unsupported attachment: ${unsupported.slice(0, 3).join(", ")}`);
    }
  }, []);

  const consumeAttachments = useCallback(
    (text: string): ConsumedChatAttachments => {
      const consumed = {
        images: pendingImages,
        message: formatAttachedFiles(text, pendingFiles),
      };
      setPendingImages([]);
      setPendingFiles([]);
      return consumed;
    },
    [pendingFiles, pendingImages]
  );

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>): void => {
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length === 0 || !hasAttachableFiles(files)) return;
      event.preventDefault();
      void addAttachmentFiles(files);
    },
    [addAttachmentFiles]
  );

  const handleComposerDrop = useCallback(
    (event: DragEvent<HTMLElement>): void => {
      const files = Array.from(event.dataTransfer?.files || []);
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      if (files.length > 0) void addAttachmentFiles(files);
      setImageDragActive(false);
    },
    [addAttachmentFiles]
  );

  const removePendingImage = useCallback((index: number): void => {
    setPendingImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const removePendingFile = useCallback((index: number): void => {
    setPendingFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  return {
    addAttachmentFiles,
    consumeAttachments,
    handleComposerDrop,
    handleComposerPaste,
    imageDragActive,
    pendingFiles,
    pendingImages,
    removePendingFile,
    removePendingImage,
    setImageDragActive,
  };
}
