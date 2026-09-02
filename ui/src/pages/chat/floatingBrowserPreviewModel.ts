export interface FloatingBrowserPreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingBrowserPreviewSize {
  width: number;
  height: number;
}

export interface FloatingBrowserPreviewVisibility {
  activeWorkspaceKind: string | null;
  artifactOpen: boolean;
  available: boolean;
  previewKind?: string;
  sessionId: string | null;
  workspacePanelOpen: boolean;
}

export const FLOATING_BROWSER_PREVIEW_STORAGE_KEY = "cybara:browser-preview:floating-rect:v2";
export const FLOATING_COMPUTER_PREVIEW_STORAGE_KEY = "cybara:computer-preview:floating-rect:v1";
export const FLOATING_BROWSER_PREVIEW_GAP = 12;
export const FLOATING_BROWSER_PREVIEW_WIDTH = 260;
export const FLOATING_BROWSER_PREVIEW_HEIGHT = 180;
export const FLOATING_BROWSER_PREVIEW_CLICK_DISTANCE = 6;

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseFloatingBrowserPreviewRect(
  value: string | null
): FloatingBrowserPreviewRect | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (
      !finiteCoordinate(record.x) ||
      !finiteCoordinate(record.y) ||
      !finitePositive(record.width) ||
      !finitePositive(record.height)
    ) {
      return null;
    }
    return {
      x: record.x,
      y: record.y,
      width: record.width,
      height: record.height,
    };
  } catch {
    return null;
  }
}

export function defaultFloatingBrowserPreviewRect(
  container: FloatingBrowserPreviewSize,
  bottomInset: number,
  horizontal: "left" | "right" = "right"
): FloatingBrowserPreviewRect {
  return clampFloatingBrowserPreviewRect(
    container,
    {
      x:
        horizontal === "left"
          ? FLOATING_BROWSER_PREVIEW_GAP
          : container.width - FLOATING_BROWSER_PREVIEW_WIDTH - FLOATING_BROWSER_PREVIEW_GAP,
      y:
        container.height -
        Math.max(0, bottomInset) -
        FLOATING_BROWSER_PREVIEW_HEIGHT -
        FLOATING_BROWSER_PREVIEW_GAP,
      width: FLOATING_BROWSER_PREVIEW_WIDTH,
      height: FLOATING_BROWSER_PREVIEW_HEIGHT,
    },
    bottomInset
  );
}

export function clampFloatingBrowserPreviewRect(
  container: FloatingBrowserPreviewSize,
  rect: FloatingBrowserPreviewRect,
  bottomInset: number
): FloatingBrowserPreviewRect {
  const containerWidth = Math.max(0, container.width);
  const containerHeight = Math.max(0, container.height);
  const reservedBottom = Math.max(0, Math.min(containerHeight, bottomInset));
  const maximumWidth = Math.max(0, containerWidth - FLOATING_BROWSER_PREVIEW_GAP * 2);
  const maximumHeight = Math.max(
    0,
    containerHeight - reservedBottom - FLOATING_BROWSER_PREVIEW_GAP * 2
  );
  const width = Math.min(maximumWidth, FLOATING_BROWSER_PREVIEW_WIDTH);
  const height = Math.min(maximumHeight, FLOATING_BROWSER_PREVIEW_HEIGHT);
  const maximumX = Math.max(
    FLOATING_BROWSER_PREVIEW_GAP,
    containerWidth - width - FLOATING_BROWSER_PREVIEW_GAP
  );
  const maximumY = Math.max(
    FLOATING_BROWSER_PREVIEW_GAP,
    containerHeight - reservedBottom - height - FLOATING_BROWSER_PREVIEW_GAP
  );
  return {
    x: Math.min(maximumX, Math.max(FLOATING_BROWSER_PREVIEW_GAP, rect.x)),
    y: Math.min(maximumY, Math.max(FLOATING_BROWSER_PREVIEW_GAP, rect.y)),
    width,
    height,
  };
}

export function shouldShowFloatingBrowserPreview({
  activeWorkspaceKind,
  artifactOpen,
  available,
  previewKind = "browser",
  sessionId,
  workspacePanelOpen,
}: FloatingBrowserPreviewVisibility): boolean {
  if (!sessionId || !available || artifactOpen) return false;
  return !(workspacePanelOpen && activeWorkspaceKind === previewKind);
}

export function isFloatingBrowserPreviewClick(deltaX: number, deltaY: number): boolean {
  return Math.hypot(deltaX, deltaY) <= FLOATING_BROWSER_PREVIEW_CLICK_DISTANCE;
}

export function readFloatingPreviewRect(storageKey: string): FloatingBrowserPreviewRect | null {
  if (typeof window === "undefined") return null;
  try {
    return parseFloatingBrowserPreviewRect(window.localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

export function persistFloatingPreviewRect(
  storageKey: string,
  rect: FloatingBrowserPreviewRect
): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(rect));
  } catch {
    return;
  }
}
