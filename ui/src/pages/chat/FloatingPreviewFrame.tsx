import { Minus, X } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  clampFloatingBrowserPreviewRect,
  defaultFloatingBrowserPreviewRect,
  FLOATING_PREVIEW_MINIMIZED_SIZE,
  type FloatingBrowserPreviewRect,
  type FloatingBrowserPreviewSize,
  isFloatingBrowserPreviewClick,
  persistFloatingPreviewMinimized,
  persistFloatingPreviewRect,
  readFloatingPreviewMinimized,
  readFloatingPreviewRect,
} from "./floatingBrowserPreviewModel";

interface FloatingPreviewFrameProps {
  ariaLabel: string;
  bottomInset: number;
  children: ReactNode;
  hideLabel?: string;
  horizontal?: "left" | "right";
  minimizeLabel?: string;
  minimizedIcon: ReactNode;
  minimizedLabel?: string;
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

const CONTROL_ATTRIBUTE = "data-floating-preview-control";

function containerSize(element: HTMLElement | null): FloatingBrowserPreviewSize {
  const bounds = element?.getBoundingClientRect();
  return {
    width: bounds?.width ?? window.innerWidth,
    height: bounds?.height ?? window.innerHeight,
  };
}

function isControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(`[${CONTROL_ATTRIBUTE}]`);
}

export function FloatingPreviewFrame({
  ariaLabel,
  bottomInset,
  children,
  hideLabel = "Close preview",
  horizontal = "right",
  minimizeLabel = "Minimize preview",
  minimizedIcon,
  minimizedLabel = "Restore preview",
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
  const [minimized, setMinimized] = useState(() => readFloatingPreviewMinimized(storageKey));

  const preferredSize = useMemo(
    () =>
      minimized
        ? { width: FLOATING_PREVIEW_MINIMIZED_SIZE, height: FLOATING_PREVIEW_MINIMIZED_SIZE }
        : undefined,
    [minimized]
  );

  const commitRect = useCallback(
    (next: FloatingBrowserPreviewRect): void => {
      setRect(next);
      if (!minimized) persistFloatingPreviewRect(storageKey, next);
    },
    [minimized, storageKey]
  );

  useEffect(() => {
    const container = frameRef.current?.parentElement;
    if (!container) return;
    const update = (): void => {
      const bounds = containerSize(container);
      containerSizeRef.current = bounds;
      setRect((current) => {
        const source = current ?? readFloatingPreviewRect(storageKey);
        return source
          ? clampFloatingBrowserPreviewRect(bounds, source, bottomInset, preferredSize)
          : defaultFloatingBrowserPreviewRect(bounds, bottomInset, horizontal, preferredSize);
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
  }, [bottomInset, horizontal, preferredSize, storageKey]);

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
          bottomInset,
          preferredSize
        )
      );
    },
    [bottomInset, preferredSize]
  );

  const restore = useCallback((): void => {
    persistFloatingPreviewMinimized(storageKey, false);
    setMinimized(false);
  }, [storageKey]);

  const finishGesture = useCallback(
    (pointerId: number): void => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== pointerId) return;
      gestureRef.current = null;
      setDragging(false);
      setRect((current) => {
        if (current && !minimized) persistFloatingPreviewRect(storageKey, current);
        return current;
      });
      if (gesture.moved) return;
      if (minimized) restore();
      else onActivate();
    },
    [minimized, onActivate, restore, storageKey]
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
      if (!rect || event.button !== 0 || isControlTarget(event.target)) return;
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
      if (!rect || isControlTarget(event.target)) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (minimized) restore();
        else onActivate();
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
          bottomInset,
          preferredSize
        )
      );
    },
    [bottomInset, commitRect, minimized, onActivate, preferredSize, rect, restore]
  );

  const stopControlGesture = useCallback((event: PointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
  }, []);

  const handleHide = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      gestureRef.current = null;
      setDragging(false);
      onHide();
    },
    [onHide]
  );

  const handleMinimize = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      gestureRef.current = null;
      setDragging(false);
      persistFloatingPreviewMinimized(storageKey, true);
      setMinimized(true);
    },
    [storageKey]
  );

  const fallbackStyle = {
    [horizontal]: 16,
    bottom: Math.max(16, bottomInset + 16),
    width: minimized ? FLOATING_PREVIEW_MINIMIZED_SIZE : "min(260px, calc(100% - 24px))",
    height: minimized ? FLOATING_PREVIEW_MINIMIZED_SIZE : "min(180px, calc(100% - 48px))",
  } as const;

  return (
    <section
      ref={frameRef}
      aria-label={minimized ? minimizedLabel : ariaLabel}
      className={cn(
        "glass-strong absolute z-40 min-h-0 touch-none overflow-hidden border border-[var(--glass-border)] shadow-[0_16px_48px_rgba(0,0,0,0.46)] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-primary))]",
        minimized ? "rounded-full" : "rounded-[16px]",
        dragging
          ? "cursor-grabbing select-none shadow-[0_22px_58px_rgba(0,0,0,0.56)]"
          : "cursor-grab transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5"
      )}
      data-minimized={minimized ? "true" : "false"}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      onPointerDown={beginGesture}
      role="button"
      style={
        rect ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height } : fallbackStyle
      }
      tabIndex={0}
      title={minimized ? minimizedLabel : title}
    >
      {minimized ? (
        <span
          className="pointer-events-none flex h-full w-full items-center justify-center text-white/85"
          data-testid={`${testId}-minimized`}
        >
          {minimizedIcon}
        </span>
      ) : (
        <>
          <div className="pointer-events-none h-full min-h-0 select-none" aria-hidden="true">
            {children}
          </div>
          <div className="absolute right-1.5 top-1.5 z-50 flex items-center gap-1">
            <button
              type="button"
              aria-label={minimizeLabel}
              className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border border-[var(--glass-border)] bg-black/45 text-white/80 transition-colors duration-150 hover:bg-black/70 hover:text-white"
              data-floating-preview-control="minimize"
              data-testid={`${testId}-minimize`}
              onClick={handleMinimize}
              onKeyDown={(event) => event.stopPropagation()}
              onPointerDown={stopControlGesture}
              title={minimizeLabel}
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={2.4} />
            </button>
            <button
              type="button"
              aria-label={hideLabel}
              className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border border-[var(--glass-border)] bg-black/45 text-white/80 transition-colors duration-150 hover:bg-black/70 hover:text-white"
              data-floating-preview-control="close"
              data-testid={`${testId}-close`}
              onClick={handleHide}
              onKeyDown={(event) => event.stopPropagation()}
              onPointerDown={stopControlGesture}
              title={hideLabel}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.4} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
