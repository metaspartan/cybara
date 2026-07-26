import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { LiveActivityItem } from "@/lib/chatActivities";
import { CHAT_FOLLOW_THRESHOLD_PX, chatBottomScrollTop, isChatNearBottom } from "./chatScroll";
import type { ChatMessage } from "./chatModel";

interface ChatScrollOptions {
  artifactViewerOpen: boolean;
  isLoading: boolean;
  liveActivities: readonly LiveActivityItem[];
  liveCurrentStep: string | null;
  messages: readonly ChatMessage[];
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  streamingContent: string | null;
}

interface ChatScrollState {
  refreshScrollToBottomVisibility: () => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  showScrollToBottomButton: boolean;
}

export function useChatScroll({
  artifactViewerOpen,
  isLoading,
  liveActivities,
  liveCurrentStep,
  messages,
  messagesContainerRef,
  streamingContent,
}: ChatScrollOptions): ChatScrollState {
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
  const keepScrolledToBottomRef = useRef(true);
  const programmaticScrollUntilRef = useRef(0);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth"): void => {
      const container = messagesContainerRef.current;
      if (!container) return;
      keepScrolledToBottomRef.current = true;
      if (behavior === "smooth") {
        programmaticScrollUntilRef.current = Number.POSITIVE_INFINITY;
        if (programmaticScrollTimeoutRef.current !== null) {
          window.clearTimeout(programmaticScrollTimeoutRef.current);
        }
        programmaticScrollTimeoutRef.current = window.setTimeout(() => {
          programmaticScrollTimeoutRef.current = null;
          programmaticScrollUntilRef.current = 0;
          const latestContainer = messagesContainerRef.current;
          if (
            !latestContainer ||
            !keepScrolledToBottomRef.current ||
            isChatNearBottom(latestContainer, CHAT_FOLLOW_THRESHOLD_PX)
          ) {
            return;
          }
          latestContainer.scrollTop = chatBottomScrollTop(latestContainer);
          setShowScrollToBottomButton(false);
        }, 2500);
      } else if (programmaticScrollUntilRef.current !== Number.POSITIVE_INFINITY) {
        programmaticScrollUntilRef.current = performance.now() + 100;
      }
      container.scrollTo({ top: container.scrollHeight, behavior });
      setShowScrollToBottomButton(false);
    },
    [messagesContainerRef]
  );

  const refreshScrollToBottomVisibility = useCallback((): void => {
    const container = messagesContainerRef.current;
    if (!container || artifactViewerOpen) {
      setShowScrollToBottomButton(false);
      return;
    }
    const nearBottom = isChatNearBottom(container, CHAT_FOLLOW_THRESHOLD_PX);
    const programmaticScrollActive = performance.now() < programmaticScrollUntilRef.current;
    if (nearBottom) {
      keepScrolledToBottomRef.current = true;
      programmaticScrollUntilRef.current = 0;
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
        programmaticScrollTimeoutRef.current = null;
      }
    } else if (!programmaticScrollActive) {
      keepScrolledToBottomRef.current = false;
    }
    setShowScrollToBottomButton(!nearBottom && !programmaticScrollActive);
  }, [artifactViewerOpen, messagesContainerRef]);

  useEffect(
    () => () => {
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const releaseProgrammaticScroll = (): void => {
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
        programmaticScrollTimeoutRef.current = null;
      }
      programmaticScrollUntilRef.current = 0;
      refreshScrollToBottomVisibility();
    };
    container.addEventListener("wheel", releaseProgrammaticScroll, { passive: true });
    container.addEventListener("touchstart", releaseProgrammaticScroll, { passive: true });
    container.addEventListener("keydown", releaseProgrammaticScroll);
    return () => {
      container.removeEventListener("wheel", releaseProgrammaticScroll);
      container.removeEventListener("touchstart", releaseProgrammaticScroll);
      container.removeEventListener("keydown", releaseProgrammaticScroll);
    };
  }, [messagesContainerRef, refreshScrollToBottomVisibility]);

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (
      !keepScrolledToBottomRef.current &&
      !isChatNearBottom(container, CHAT_FOLLOW_THRESHOLD_PX)
    ) {
      setShowScrollToBottomButton(true);
      return;
    }
    keepScrolledToBottomRef.current = true;
    container.scrollTop = chatBottomScrollTop(container);
    setShowScrollToBottomButton(false);
  }, [messages, messagesContainerRef]);

  useEffect(() => {
    if (artifactViewerOpen) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    if (!keepScrolledToBottomRef.current && !isChatNearBottom(container, CHAT_FOLLOW_THRESHOLD_PX))
      return;
    const rafId = window.requestAnimationFrame(() => scrollToBottom("auto"));
    return () => window.cancelAnimationFrame(rafId);
  }, [
    artifactViewerOpen,
    liveActivities,
    liveCurrentStep,
    messagesContainerRef,
    scrollToBottom,
    streamingContent,
  ]);

  useEffect(() => {
    if (artifactViewerOpen || typeof ResizeObserver === "undefined") return;
    const container = messagesContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (keepScrolledToBottomRef.current) {
          const targetScrollTop = chatBottomScrollTop(container);
          if (Math.abs(container.scrollTop - targetScrollTop) > 1) {
            container.scrollTop = targetScrollTop;
          }
        } else {
          refreshScrollToBottomVisibility();
        }
      });
    });
    observer.observe(container);
    const observeChildren = (): void => {
      for (const child of container.children) observer.observe(child);
    };
    observeChildren();
    const mutationObserver = new MutationObserver(observeChildren);
    mutationObserver.observe(container, { childList: true });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [artifactViewerOpen, messagesContainerRef, refreshScrollToBottomVisibility]);

  useEffect(() => {
    const rafId = window.requestAnimationFrame(refreshScrollToBottomVisibility);
    return () => window.cancelAnimationFrame(rafId);
  }, [artifactViewerOpen, isLoading, messages.length, refreshScrollToBottomVisibility]);

  return {
    refreshScrollToBottomVisibility,
    scrollToBottom,
    showScrollToBottomButton,
  };
}
