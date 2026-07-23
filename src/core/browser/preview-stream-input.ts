import * as pwManager from "./pw-manager";
import { invalidateBrowserPreview } from "./preview-cache";

export type BrowserPreviewInput =
  | { type: "scroll"; deltaX: number; deltaY: number }
  | { type: "pointer_click"; x: number; y: number }
  | { type: "keyboard"; key: string };

export interface BrowserPreviewInputHandlers {
  scroll(pageId: string, deltaX: number, deltaY: number): Promise<void>;
  click(pageId: string, x: number, y: number): Promise<void>;
  keyboard(pageId: string, key: string): Promise<void>;
  invalidate(pageId: string): void;
}

const defaultHandlers: BrowserPreviewInputHandlers = {
  scroll: pwManager.scrollPage,
  click: pwManager.clickAt,
  keyboard: pwManager.sendKey,
  invalidate: invalidateBrowserPreview,
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseBrowserPreviewInput(value: unknown): BrowserPreviewInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.type === "scroll") {
    const deltaX = finiteNumber(input.deltaX);
    const deltaY = finiteNumber(input.deltaY);
    if (deltaX === null || deltaY === null) return null;
    return {
      type: "scroll",
      deltaX: Math.min(4_000, Math.max(-4_000, deltaX)),
      deltaY: Math.min(4_000, Math.max(-4_000, deltaY)),
    };
  }
  if (input.type === "pointer_click") {
    const x = finiteNumber(input.x);
    const y = finiteNumber(input.y);
    return x === null || y === null || x < 0 || y < 0 || x > 10_000 || y > 10_000
      ? null
      : { type: "pointer_click", x, y };
  }
  if (input.type === "keyboard") {
    const key = typeof input.key === "string" ? input.key : "";
    return key.length > 0 && key.length <= 32 ? { type: "keyboard", key } : null;
  }
  return null;
}

export async function executeBrowserPreviewInput(
  pageId: string,
  input: BrowserPreviewInput,
  handlers: BrowserPreviewInputHandlers = defaultHandlers
): Promise<void> {
  if (input.type === "scroll") await handlers.scroll(pageId, input.deltaX, input.deltaY);
  else if (input.type === "pointer_click") await handlers.click(pageId, input.x, input.y);
  else await handlers.keyboard(pageId, input.key);
  handlers.invalidate(pageId);
}
