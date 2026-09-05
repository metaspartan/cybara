import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  clampFloatingBrowserPreviewRect,
  defaultFloatingBrowserPreviewRect,
  isFloatingBrowserPreviewClick,
  persistFloatingPreviewRect,
  readFloatingPreviewRect,
  type FloatingBrowserPreviewRect,
  type FloatingBrowserPreviewSize,
} from "./floatingBrowserPreviewModel";

interface FloatingPreviewFrameProps {
  ariaLabel: string;
  bottomInset: number;
  children: ReactNode;
  hideLabel?: string;
  horizontal?: "left" | "right";
  onActivate: () => void;
  onHide: () => void;
  storageKey: string;
  testId: string;
  title: string;
}

interface FloatingPreviewGesture {
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

export function FloatingPreviewFrame({
  ariaLabel,
  bottomInset,
  children,
  hideLabel = "Hide preview",
  horizontal = "right",
  onActivate,
  onHide,
  storageKey,
  testId,
  title,
}: FloatingPreviewFrameProps): ReactElement {
  const frameRef = useRef<HTMLElement>(null);
  const gestureRef = useRef<FloatingPreviewGesture | null>(null);
  const containerSizeRef = useRef<FloatingBrowserPreviewSize>({ width: 0, height: 0 });
  const [rect, setRect] = useState<FloatingBrowserPreviewRect | null>(null);
  const [dragging, setDragging] = useState(false);

  const commitRect = useCallback(
    (next: FloatingBrowserPreviewRect): void => {
      setRect(next);
      persistFloatingPreviewRect(storageKey, next);
    },
    [storageKey]
  );

  useEffect(() => {
    const container = frameRef.current?.parentElement;
    if (!container) return;
    const update = (): void => {
      const size = containerSize(container);
      containerSizeRef.current = size;
      setRect((current) => {
        const source = current ?? readFloatingPreviewRect(storageKey);
        return source
          ? clampFloatingBrowserPreviewRect(size, source, bottomInset)
          : defaultFloatingBrowserPreviewRect(size, bottomInset, horizontal);
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
  }, [bottomInset, horizontal, storageKey]);

  const updateGesture = useCallback(
    (pointerId: number, clientX: number, clientY: number): void => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== pointerId) return;
      const deltaX = clientX - gesture.startX;
      const deltaY = clientY - gesture.startY;
      gesture.moved = !isFloatingBrowserPreviewClick(deltaX, deltaY);
      setRect(
        clampFloatingBrowserPreviewRect(
          containerSizeRef.current,
          {
            ...gesture.origin,
            x: gesture.origin.x + deltaX,
            y: gesture.origin.y + deltaY,
          },
          bottomInset
        )
      );
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
        if (current) persistFloatingPreviewRect(storageKey, current);
        return current;
      });
      if (!gesture.moved) onActivate();
    },
    [onActivate, storageKey]
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

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (!rect) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate();
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
    [bottomInset, commitRect, onActivate, rect]
  );

  const handleHide = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.stopPropagation();
      onHide();
    },
    [onHide]
  );

  return (
    <section
      ref={frameRef}
      aria-label={ariaLabel}
      className={cn(
        "glass-strong absolute z-40 min-h-0 touch-none overflow-hidden rounded-[16px] border border-[var(--glass-border)] shadow-[0_16px_48px_rgba(0,0,0,0.46)] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-primary))]",
        dragging
          ? "cursor-grabbing select-none shadow-[0_22px_58px_rgba(0,0,0,0.56)]"
          : "cursor-grab transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5"
      )}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      onPointerDown={beginGesture}
      role="button"
      style={
        rect
          ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
          : {
              [horizontal]: 16,
              bottom: Math.max(16, bottomInset + 16),
              width: "min(260px, calc(100% - 24px))",
              height: "min(180px, calc(100% - 48px))",
            }
      }
      tabIndex={0}
      title={title}
    >
      <div className="pointer-events-none h-full min-h-0 select-none" aria-hidden="true">
        {children}
      </div>
      <button
        type="button"
        aria-label={hideLabel}
        className="pointer-events-auto absolute right-2 top-2 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--glass-border)] bg-black/45 text-white/80 transition-opacity duration-150 hover:bg-black/70 hover:text-white focus-visible:opacity-100"
        onClick={handleHide}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        title={hideLabel}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.4} />
      </button>
    </section>
  );
}
