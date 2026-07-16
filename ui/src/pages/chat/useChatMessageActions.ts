import { useCallback, useEffect, useRef, useState } from "react";
import { chatApi } from "@/lib/api";
import { appendApiTokenParam } from "@/lib/auth";
import { useUIStore } from "@/stores/uiStore";
import type { ChatLightboxImage } from "./ChatImageLightbox";

interface ChatImageLightboxState {
  images: ChatLightboxImage[];
  index: number;
}

interface ChatMessageActions {
  copiedMessageIndex: number | null;
  handleCopyMessage: (index: number, content: string) => Promise<void>;
  handleReadAloud: (index: number, content: string) => Promise<void>;
  imageLightbox: ChatImageLightboxState | null;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  openChatImage: (src: string, alt: string) => void;
  setImageLightbox: React.Dispatch<React.SetStateAction<ChatImageLightboxState | null>>;
  speakingMessageIndex: number | null;
}

function collectLightboxImages(container: HTMLDivElement | null): ChatLightboxImage[] {
  const nodes = Array.from(
    container?.querySelectorAll<HTMLElement>("[data-chat-lightbox-src]") ?? []
  );
  return nodes
    .map((node) => ({
      src: node.dataset.chatLightboxSrc?.trim() || "",
      alt: node.dataset.chatLightboxAlt?.trim() || "Image",
    }))
    .filter((image) => image.src.length > 0);
}

export function useChatMessageActions(): ChatMessageActions {
  const [imageLightbox, setImageLightbox] = useState<ChatImageLightboxState | null>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState<number | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const copiedMessageTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedMessageTimerRef.current !== null) {
        window.clearTimeout(copiedMessageTimerRef.current);
      }
      speechAudioRef.current?.pause();
      speechAudioRef.current = null;
    },
    []
  );

  const handleCopyMessage = useCallback(async (index: number, content: string): Promise<void> => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch (error) {
        console.error("Failed to copy message:", error);
      }
    }
    if (!copied) return;
    setCopiedMessageIndex(index);
    if (copiedMessageTimerRef.current !== null) {
      window.clearTimeout(copiedMessageTimerRef.current);
    }
    copiedMessageTimerRef.current = window.setTimeout(() => {
      setCopiedMessageIndex(null);
      copiedMessageTimerRef.current = null;
    }, 1500);
  }, []);

  const handleReadAloud = useCallback(
    async (index: number, content: string): Promise<void> => {
      const activeAudio = speechAudioRef.current;
      if (activeAudio) {
        activeAudio.pause();
        speechAudioRef.current = null;
        setSpeakingMessageIndex(null);
        if (speakingMessageIndex === index) return;
      }
      try {
        setSpeakingMessageIndex(index);
        const result = await chatApi.synthesizeSpeech({ text: content });
        if (!result.success || !result.data?.audioPath) {
          throw new Error(result.error || "Speech synthesis failed");
        }
        const mediaUrl = appendApiTokenParam(
          `/api/media?path=${encodeURIComponent(result.data.audioPath)}`
        );
        const audio = new Audio(mediaUrl);
        speechAudioRef.current = audio;
        const clear = (): void => {
          if (speechAudioRef.current === audio) speechAudioRef.current = null;
          setSpeakingMessageIndex(null);
        };
        audio.addEventListener("ended", clear, { once: true });
        audio.addEventListener("error", clear, { once: true });
        await audio.play();
      } catch (error) {
        speechAudioRef.current = null;
        setSpeakingMessageIndex(null);
        useUIStore
          .getState()
          .addToast("error", error instanceof Error ? error.message : "Speech synthesis failed");
      }
    },
    [speakingMessageIndex]
  );

  const openChatImage = useCallback((src: string, alt: string): void => {
    const images = collectLightboxImages(messagesContainerRef.current);
    const index = Math.max(
      0,
      images.findIndex((image) => image.src === src && image.alt === alt)
    );
    setImageLightbox({
      images: images.length > 0 ? images : [{ src, alt }],
      index,
    });
  }, []);

  return {
    copiedMessageIndex,
    handleCopyMessage,
    handleReadAloud,
    imageLightbox,
    messagesContainerRef,
    openChatImage,
    setImageLightbox,
    speakingMessageIndex,
  };
}
