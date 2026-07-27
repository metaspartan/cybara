import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface SimulatorPreviewImageProps {
  source: string;
  alt: string;
  className?: string;
}

export function isRenderableSimulatorImage(image: {
  complete: boolean;
  naturalHeight: number;
  naturalWidth: number;
}): boolean {
  return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
}

export function SimulatorPreviewImage({ source, alt, className }: SimulatorPreviewImageProps) {
  const [presentedSource, setPresentedSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let paintHandle: number | null = null;
    const next = new Image();
    next.decoding = "async";
    const present = (): void => {
      if (!active || !isRenderableSimulatorImage(next)) return;
      paintHandle = window.requestAnimationFrame(() => {
        if (active) setPresentedSource(source);
      });
    };
    next.src = source;
    if (typeof next.decode === "function") {
      next.decode().then(present, present);
    } else {
      next.onload = present;
    }
    return () => {
      active = false;
      if (paintHandle !== null) window.cancelAnimationFrame(paintHandle);
    };
  }, [source]);

  return (
    <img
      alt={alt}
      className={cn(className, !presentedSource && "invisible")}
      decoding="async"
      draggable={false}
      src={presentedSource || undefined}
    />
  );
}
