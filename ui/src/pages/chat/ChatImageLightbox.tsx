import { ChevronLeft, ChevronRight, Download, Minus, Plus, RotateCcw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { clampLightboxZoom, LIGHTBOX_ZOOM_STEP, nextLightboxIndex } from "./imageLightboxModel";

export interface ChatLightboxImage {
  src: string;
  alt: string;
}

const LIGHTBOX_CONTROL_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40";

export function ChatImageLightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: ChatLightboxImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), images.length - 1));
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const current = images[index];
  onCloseRef.current = onClose;

  const resetView = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const move = useCallback(
    (direction: -1 | 1) => {
      setIndex((currentIndex) => nextLightboxIndex(currentIndex, direction, images.length));
      resetView();
    },
    [images.length, resetView]
  );

  const changeZoom = useCallback((delta: number) => {
    setZoom((currentZoom) => {
      const nextZoom = clampLightboxZoom(currentZoom + delta);
      if (nextZoom === 1) setPosition({ x: 0, y: 0 });
      return nextZoom;
    });
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      else if (event.key === "ArrowLeft") move(-1);
      else if (event.key === "ArrowRight") move(1);
      else if (event.key === "+" || event.key === "=") changeZoom(LIGHTBOX_ZOOM_STEP);
      else if (event.key === "-") changeZoom(-LIGHTBOX_ZOOM_STEP);
      else if (event.key === "0") resetView();
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [changeZoom, move, resetView]);

  if (!current) return null;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setPosition((currentPosition) => ({
      x: currentPosition.x + deltaX,
      y: currentPosition.y + deltaY,
    }));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? LIGHTBOX_ZOOM_STEP : -LIGHTBOX_ZOOM_STEP);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-xl"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="relative z-20 flex h-14 shrink-0 items-center border-b border-white/10 bg-black/40 px-3 sm:px-5">
        <div className="min-w-0 flex-1 truncate text-xs text-gray-300">
          {current.alt || "Image"}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => changeZoom(-LIGHTBOX_ZOOM_STEP)}
            className={LIGHTBOX_CONTROL_CLASS}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={resetView}
            className="min-w-14 rounded-md px-2 py-1.5 text-xs tabular-nums text-gray-300 hover:bg-white/10 hover:text-white"
            aria-label="Reset zoom"
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => changeZoom(LIGHTBOX_ZOOM_STEP)}
            className={LIGHTBOX_CONTROL_CLASS}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={resetView}
            className={`${LIGHTBOX_CONTROL_CLASS} hidden sm:inline-flex`}
            aria-label="Fit image"
            title="Fit image"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <a
            href={current.src}
            download
            className={LIGHTBOX_CONTROL_CLASS}
            aria-label="Download image"
            title="Download image"
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className={`${LIGHTBOX_CONTROL_CLASS} ml-1`}
            aria-label="Close image preview"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={() => (zoom === 1 ? changeZoom(1) : resetView())}
        onClick={(event) => {
          if (event.target === event.currentTarget && zoom === 1) onClose();
        }}
      >
        <img
          key={`${index}-${current.src}`}
          src={current.src}
          alt={current.alt || "Image"}
          className="pointer-events-none absolute left-1/2 top-1/2 max-h-[calc(100vh-5rem)] max-w-[calc(100vw-2rem)] select-none object-contain transition-transform duration-100 ease-out"
          style={{
            transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${zoom})`,
          }}
          draggable={false}
        />

        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => move(-1)}
              className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/10 bg-black/60 p-2.5 text-gray-200 shadow-xl hover:bg-white/15 hover:text-white"
              aria-label="Previous image"
              title="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/10 bg-black/60 p-2.5 text-gray-200 shadow-xl hover:bg-white/15 hover:text-white"
              aria-label="Next image"
              title="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : null}
      </div>

      {images.length > 1 ? (
        <footer className="relative z-20 flex h-10 shrink-0 items-center justify-center border-t border-white/10 bg-black/40 text-xs tabular-nums text-gray-400">
          {index + 1} / {images.length}
        </footer>
      ) : null}
    </div>,
    document.body
  );
}
