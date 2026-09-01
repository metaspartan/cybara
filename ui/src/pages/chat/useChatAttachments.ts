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
import type { ChatImageAttachment } from "@/types";

interface ConsumedChatAttachments {
  images: ChatImageAttachment[];
  message: string;
}

interface UseChatAttachmentsResult {
  addAttachmentFiles: (files: Iterable<File>) => Promise<void>;
  consumeAttachments: (text: string) => ConsumedChatAttachments;
  handleComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
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

export function useChatAttachments(): UseChatAttachmentsResult {
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatFileAttachment[]>([]);
  const [imageDragActive, setImageDragActive] = useState(false);

  const addAttachmentFiles = useCallback(async (files: Iterable<File>): Promise<void> => {
    const images: ChatImageAttachment[] = [];
    const texts: ChatFileAttachment[] = [];
    for (const file of files) {
      if (isSupportedImageType(file.type, file.name)) {
        if (file.size <= MAX_CHAT_IMAGE_BYTES) images.push(await fileToChatImage(file));
      } else if (isTextLikeFile(file) && file.size <= MAX_TEXT_FILE_BYTES) {
        texts.push(await fileToTextAttachment(file));
      }
    }
    if (images.length > 0) {
      setPendingImages((previous) => [...previous, ...images].slice(0, MAX_CHAT_IMAGES));
    }
    if (texts.length > 0) {
      setPendingFiles((previous) => [...previous, ...texts].slice(0, MAX_TEXT_FILES));
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
    (event: DragEvent<HTMLDivElement>): void => {
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length > 0 && hasAttachableFiles(files)) {
        event.preventDefault();
        void addAttachmentFiles(files);
      }
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
