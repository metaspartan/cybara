import type { DragEventHandler } from "react";
import { useCallback } from "react";
import { dataTransferHasFiles } from "@/lib/fileDrop";

interface ChatFileDropSurfaceHandlers {
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLElement>;
}

export function useChatFileDropSurface({
  onDragActiveChange,
  onDrop,
}: {
  onDragActiveChange: (active: boolean) => void;
  onDrop: DragEventHandler<HTMLElement>;
}): ChatFileDropSurfaceHandlers {
  const onDragOver = useCallback<DragEventHandler<HTMLDivElement>>(
    (event) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      onDragActiveChange(true);
    },
    [onDragActiveChange]
  );
  const onDragLeave = useCallback<DragEventHandler<HTMLDivElement>>(
    (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
      onDragActiveChange(false);
    },
    [onDragActiveChange]
  );

  return { onDragLeave, onDragOver, onDrop };
}
