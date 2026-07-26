import { useEffect, useRef } from "react";

interface SimulatorPreviewImageProps {
  source: string;
  alt: string;
  className?: string;
}

export function SimulatorPreviewImage({ source, alt, className }: SimulatorPreviewImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    if (!image.getAttribute("src")) {
      image.src = source;
      return;
    }
    let active = true;
    const next = new Image();
    next.decoding = "async";
    next.src = source;
    const swap = (): void => {
      if (active && imageRef.current) imageRef.current.src = source;
    };
    if (typeof next.decode === "function") {
      next.decode().then(swap, swap);
    } else {
      next.onload = swap;
      next.onerror = swap;
    }
    return () => {
      active = false;
    };
  }, [source]);

  return <img ref={imageRef} alt={alt} className={className} decoding="async" draggable={false} />;
}
