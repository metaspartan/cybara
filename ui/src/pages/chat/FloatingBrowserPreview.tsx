import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { ChatWorkspaceBrowser } from "./ChatWorkspaceBrowser";
import {
  clampFloatingBrowserPreviewRect,
  defaultFloatingBrowserPreviewRect,
  isFloatingBrowserPreviewClick,
  persistFloatingBrowserPreviewRect,
  readFloatingBrowserPreviewRect,
  type FloatingBrowserPreviewRect,
  type FloatingBrowserPreviewSize,
} from "./floatingBrowserPreviewModel";

interface FloatingBrowserPreviewProps {
  bottomInset: number;
  pageKey?: string;
  sessionId: string;
  onExpand: () => void;
}

interface FloatingBrowserPreviewGesture {
  pointerId: number;
  startX: number;
  startY: number;
  origin: FloatingBrowserPreviewRect;
  moved: boolean;
}

function containerSize(element: HTMLElement | null): FloatingBrowserPreviewSize {
  const bounds = element?.getBoundingClientRect();
  return {
    width: bounds?.width ?? window.innerWidth,
    height: bounds?.height ?? window.innerHeight,
  };
}

export function FloatingBrowserPreview({
  bottomInset,
  pageKey,
  sessionId,
  onExpand,
}: FloatingBrowserPreviewProps): ReactElement {
  const frameRef = useRef<HTMLElement>(null);
  const gestureRef = useRef<FloatingBrowserPreviewGesture | null>(null);
  const containerSizeRef = useRef<FloatingBrowserPreviewSize>({ width: 0, height: 0 });
  const [rect, setRect] = useState<FloatingBrowserPreviewRect | null>(null);
  const [dragging, setDragging] = useState(false);

  const commitRect = useCallback((next: FloatingBrowserPreviewRect): void => {
    setRect(next);
    persistFloatingBrowserPreviewRect(next);
  }, []);

  useEffect(() => {
    const container = frameRef.current?.parentElement;
    if (!container) return;
    const update = (): void => {
      const size = containerSize(container);
      containerSizeRef.current = size;
      setRect((current) => {
        const source = current ?? readFloatingBrowserPreviewRect();
        return source
          ? clampFloatingBrowserPreviewRect(size, source, bottomInset)
          : defaultFloatingBrowserPreviewRect(size, bottomInset);
      });
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [bottomInset]);

  const updateGesture = useCallback(
    (pointerId: number, clientX: number, clientY: number): void => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== pointerId) return;
      const deltaX = clientX - gesture.startX;
      const deltaY = clientY - gesture.startY;
      gesture.moved = !isFloatingBrowserPreviewClick(deltaX, deltaY);
      const next = {
        ...gesture.origin,
        x: gesture.origin.x + deltaX,
        y: gesture.origin.y + deltaY,
      };
      setRect(clampFloatingBrowserPreviewRect(containerSizeRef.current, next, bottomInset));
    },
    [bottomInset]
  );

  const finishGesture = useCallback(
    (pointerId: number): void => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== pointerId) return;
      gestureRef.current = null;
      setDragging(false);
      setRect((current) => {
        if (current) persistFloatingBrowserPreviewRect(current);
        return current;
      });
      if (!gesture.moved) onExpand();
    },
    [onExpand]
  );

  useEffect(() => {
    const move = (event: globalThis.PointerEvent): void => {
      updateGesture(event.pointerId, event.clientX, event.clientY);
    };
    const finish = (event: globalThis.PointerEvent): void => finishGesture(event.pointerId);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [finishGesture, updateGesture]);

  const beginGesture = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      if (!rect || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: rect,
        moved: false,
      };
      setDragging(true);
    },
    [rect]
  );

  const handleHeaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (!rect) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onExpand();
        return;
      }
      const distance = event.shiftKey ? 32 : 12;
      const delta =
        event.key === "ArrowLeft"
          ? { x: -distance, y: 0 }
          : event.key === "ArrowRight"
            ? { x: distance, y: 0 }
            : event.key === "ArrowUp"
              ? { x: 0, y: -distance }
              : event.key === "ArrowDown"
                ? { x: 0, y: distance }
                : null;
      if (!delta) return;
      event.preventDefault();
      commitRect(
        clampFloatingBrowserPreviewRect(
          containerSizeRef.current,
          { ...rect, x: rect.x + delta.x, y: rect.y + delta.y },
          bottomInset
        )
      );
    },
    [bottomInset, commitRect, onExpand, rect]
  );

  return (
    <section
      ref={frameRef}
      aria-label="Open live browser preview"
      className={cn(
        "glass-strong absolute z-40 min-h-0 touch-none overflow-hidden rounded-[16px] border border-[var(--glass-border)] shadow-[0_16px_48px_rgba(0,0,0,0.46)] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-primary))]",
        dragging
          ? "cursor-grabbing select-none shadow-[0_22px_58px_rgba(0,0,0,0.56)]"
          : "cursor-grab transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5"
      )}
      data-testid="floating-browser-preview"
      onKeyDown={handleHeaderKeyDown}
      onPointerDown={beginGesture}
      role="button"
      style={
        rect
          ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
          : {
              right: 16,
              bottom: Math.max(16, bottomInset + 16),
              width: "min(260px, calc(100% - 24px))",
              height: "min(180px, calc(100% - 48px))",
            }
      }
      tabIndex={0}
      title="Open browser panel"
    >
      <div className="pointer-events-none h-full min-h-0 select-none" aria-hidden="true">
        <ChatWorkspaceBrowser pageKey={pageKey} sessionId={sessionId} thumbnail visible />
      </div>
    </section>
  );
}
