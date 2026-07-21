import { type DragEventHandler, useCallback, useEffect, useRef, useState } from "react";
import {
  acceptsMultiChatDrag,
  type MultiChatDropRect,
  readMultiChatDragSessionId,
  resolveMultiChatDropIndex,
} from "./multiChatLayout";

interface UseMultiChatDropTargetOptions {
  onDropSession: (sessionId: string, index: number) => void;
  onTargetChange: (index: number | null) => void;
}

interface MultiChatDropTargetHandlers {
  active: boolean;
  clear: () => void;
  onDragEnter: DragEventHandler<HTMLElement>;
  onDragLeave: DragEventHandler<HTMLElement>;
  onDragOver: DragEventHandler<HTMLElement>;
  onDrop: DragEventHandler<HTMLElement>;
}

function readDropRects(container: HTMLElement): MultiChatDropRect[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-multi-chat-drop-index]"))
    .map((element) => {
      const index = Number.parseInt(element.dataset.multiChatDropIndex ?? "", 10);
      if (!Number.isInteger(index)) return null;
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        index,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      };
    })
    .filter((rect): rect is MultiChatDropRect => rect !== null);
}

function targetIndexForEvent(event: {
  clientX: number;
  clientY: number;
  currentTarget: HTMLElement;
}): number | null {
  return resolveMultiChatDropIndex(
    event.clientX,
    event.clientY,
    readDropRects(event.currentTarget)
  );
}

export function useMultiChatDropTarget({
  onDropSession,
  onTargetChange,
}: UseMultiChatDropTargetOptions): MultiChatDropTargetHandlers {
  const [active, setActive] = useState(false);
  const leaveTimerRef = useRef<number | null>(null);

  const cancelLeave = useCallback((): void => {
    if (leaveTimerRef.current === null) return;
    window.clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = null;
  }, []);

  const clear = useCallback((): void => {
    cancelLeave();
    setActive(false);
    onTargetChange(null);
  }, [cancelLeave, onTargetChange]);

  const activate = useCallback(
    (event: {
      clientX: number;
      clientY: number;
      currentTarget: HTMLElement;
      dataTransfer: DataTransfer;
      preventDefault: () => void;
    }): boolean => {
      if (!acceptsMultiChatDrag(event.dataTransfer.types)) return false;
      event.preventDefault();
      cancelLeave();
      setActive(true);
      onTargetChange(targetIndexForEvent(event));
      return true;
    },
    [cancelLeave, onTargetChange]
  );

  const onDragEnter = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      activate(event);
    },
    [activate]
  );

  const onDragOver = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      if (!activate(event)) return;
      event.dataTransfer.dropEffect = "move";
    },
    [activate]
  );

  const onDragLeave = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
      cancelLeave();
      leaveTimerRef.current = window.setTimeout(clear, 80);
    },
    [cancelLeave, clear]
  );

  const onDrop = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      const sessionId = readMultiChatDragSessionId(event.dataTransfer);
      if (!sessionId) return;
      event.preventDefault();
      const targetIndex = targetIndexForEvent(event);
      clear();
      if (sessionId && targetIndex !== null) onDropSession(sessionId, targetIndex);
    },
    [clear, onDropSession]
  );

  useEffect(() => () => cancelLeave(), [cancelLeave]);

  return { active, clear, onDragEnter, onDragLeave, onDragOver, onDrop };
}
