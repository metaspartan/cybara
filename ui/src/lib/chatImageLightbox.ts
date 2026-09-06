import type { ChatLightboxImage } from "@/pages/chat/ChatImageLightbox";

const OPEN_CHAT_LIGHTBOX_EVENT = "cybara:open-chat-lightbox";

function supportsEvents(): boolean {
  return (
    typeof globalThis.addEventListener === "function" &&
    typeof globalThis.dispatchEvent === "function" &&
    typeof globalThis.CustomEvent === "function"
  );
}

export function openChatImageLightbox(src: string, alt: string): void {
  if (!supportsEvents()) return;
  globalThis.dispatchEvent(
    new CustomEvent<ChatLightboxImage>(OPEN_CHAT_LIGHTBOX_EVENT, {
      detail: { src, alt },
    })
  );
}

export function onOpenChatImageLightbox(listener: (image: ChatLightboxImage) => void): () => void {
  if (!supportsEvents()) return () => undefined;
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<ChatLightboxImage>).detail;
    if (detail && typeof detail.src === "string") listener(detail);
  };
  globalThis.addEventListener(OPEN_CHAT_LIGHTBOX_EVENT, handler);
  return () => globalThis.removeEventListener(OPEN_CHAT_LIGHTBOX_EVENT, handler);
}
