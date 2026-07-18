import { ImageOff, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { loadChatImageSource, requiresAuthenticatedImageFetch } from "@/lib/chatImages";
import { cn } from "@/lib/utils";

interface ChatImagePreviewProps {
  source: string;
  alt: string;
  width: number;
  height: number;
  className: string;
  containerClassName: string;
  onOpen: (src: string, alt: string) => void;
}

export function ChatImagePreview({
  source,
  alt,
  width,
  height,
  className,
  containerClassName,
  onOpen,
}: ChatImagePreviewProps) {
  const [displaySource, setDisplaySource] = useState(() =>
    requiresAuthenticatedImageFetch(source) ? "" : source
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let revoke: (() => void) | undefined;
    setFailed(false);
    setDisplaySource(requiresAuthenticatedImageFetch(source) ? "" : source);
    void loadChatImageSource(source)
      .then((loaded) => {
        if (!active) {
          loaded.revoke?.();
          return;
        }
        revoke = loaded.revoke;
        setDisplaySource(loaded.src);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      revoke?.();
    };
  }, [source]);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${alt} unavailable`}
        className={cn(
          containerClassName,
          "flex aspect-[16/10] items-center justify-center gap-2 text-xs text-[var(--text-muted)]"
        )}
      >
        <ImageOff className="h-4 w-4" />
        Image unavailable
      </div>
    );
  }

  if (!displaySource) {
    return (
      <div
        role="status"
        aria-label={`Loading ${alt}`}
        className={cn(
          containerClassName,
          "flex aspect-[16/10] items-center justify-center text-[var(--text-muted)]"
        )}
      >
        <LoaderCircle className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(displaySource, alt)}
      data-chat-lightbox-src={displaySource}
      data-chat-lightbox-alt={alt}
      className={containerClassName}
      aria-label={`Open ${alt} preview`}
    >
      <img
        src={displaySource}
        alt={alt}
        loading="lazy"
        decoding="async"
        width={width}
        height={height}
        className={className}
        onError={() => setFailed(true)}
      />
    </button>
  );
}
