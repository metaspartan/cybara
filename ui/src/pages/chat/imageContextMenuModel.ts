export const CONTEXT_MENU_WIDTH = 208;
const CONTEXT_MENU_HEIGHT = 92;
const VIEWPORT_MARGIN = 8;

export interface ChatImageContextMenuPosition {
  x: number;
  y: number;
}

export function clampContextMenuPosition(
  position: ChatImageContextMenuPosition,
  viewport: { width: number; height: number }
): ChatImageContextMenuPosition {
  return {
    x: Math.max(
      VIEWPORT_MARGIN,
      Math.min(position.x, viewport.width - CONTEXT_MENU_WIDTH - VIEWPORT_MARGIN)
    ),
    y: Math.max(
      VIEWPORT_MARGIN,
      Math.min(position.y, viewport.height - CONTEXT_MENU_HEIGHT - VIEWPORT_MARGIN)
    ),
  };
}
