import { type DragEventHandler, useCallback } from "react";
import { MULTI_CHAT_DRAG_TYPE } from "./multiChatLayout";

interface UseMultiChatDropTargetOptions {
  active: boolean;
  index: number;
  onDropSession: (sessionId: string, index: number) => void;
  onTargetChange: (index: number, active: boolean) => void;
}

interface MultiChatDropTargetHandlers {
  active: boolean;
  onDragEnter: DragEventHandler<HTMLElement>;
  onDragLeave: DragEventHandler<HTMLElement>;
  onDragOver: DragEventHandler<HTMLElement>;
  onDrop: DragEventHandler<HTMLElement>;
}

export function useMultiChatDropTarget({
  active,
  index,
  onDropSession,
  onTargetChange,
}: UseMultiChatDropTargetOptions): MultiChatDropTargetHandlers {
  const acceptsDrop = useCallback(
    (types: readonly string[]): boolean => types.includes(MULTI_CHAT_DRAG_TYPE),
    []
  );

  const onDragEnter = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      if (!acceptsDrop(event.dataTransfer.types)) return;
      event.preventDefault();
      onTargetChange(index, true);
    },
    [acceptsDrop, index, onTargetChange]
  );

  const onDragOver = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      if (!acceptsDrop(event.dataTransfer.types)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (!active) onTargetChange(index, true);
    },
    [acceptsDrop, active, index, onTargetChange]
  );

  const onDragLeave = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
      onTargetChange(index, false);
    },
    [index, onTargetChange]
  );

  const onDrop = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      if (!acceptsDrop(event.dataTransfer.types)) return;
      event.preventDefault();
      const sessionId = event.dataTransfer.getData(MULTI_CHAT_DRAG_TYPE).trim();
      onTargetChange(index, false);
      if (sessionId) onDropSession(sessionId, index);
    },
    [acceptsDrop, index, onDropSession, onTargetChange]
  );

  return { active, onDragEnter, onDragLeave, onDragOver, onDrop };
}
