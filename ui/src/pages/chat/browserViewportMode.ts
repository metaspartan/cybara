import { browserPreviewViewport } from "./browserPreviewTiming";
import {
  BROWSER_VIEWPORT_PRESETS,
  DEFAULT_BROWSER_VIEWPORT,
  inferBrowserViewportMode,
  isBrowserViewportMode,
  parseBrowserViewportMode,
  type BrowserViewport,
  type BrowserViewportMode,
} from "../../../../shared/browser-viewport";

export {
  BROWSER_VIEWPORT_PRESETS,
  DEFAULT_BROWSER_VIEWPORT,
  inferBrowserViewportMode,
  isBrowserViewportMode,
  parseBrowserViewportMode,
  type BrowserViewport,
  type BrowserViewportMode,
} from "../../../../shared/browser-viewport";

export const BROWSER_VIEWPORT_MODE_STORAGE_KEY = "cybara.browser.viewport-mode";

export function initialBrowserViewportMode(
  storedMode: unknown,
  thumbnail: boolean
): BrowserViewportMode {
  if (thumbnail) return "desktop";
  return isBrowserViewportMode(storedMode) ? storedMode : "desktop";
}

export function browserPreviewSurfaceSize(width: number, height: number): BrowserViewport | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

export function shouldSyncRemoteBrowserViewportMode(
  value: unknown,
  currentMode: BrowserViewportMode,
  visible: boolean,
  thumbnail: boolean,
  localChangeAt: number,
  now: number
): value is BrowserViewportMode {
  if (!visible || thumbnail || !isBrowserViewportMode(value)) return false;
  return value === currentMode || now - localChangeAt >= 1_000;
}

export function browserViewportForMode(
  mode: BrowserViewportMode,
  surface: BrowserViewport | null
): BrowserViewport {
  if (mode !== "responsive") return BROWSER_VIEWPORT_PRESETS[mode];
  return browserPreviewViewport(
    surface?.width ?? DEFAULT_BROWSER_VIEWPORT.width,
    surface?.height ?? DEFAULT_BROWSER_VIEWPORT.height
  );
}

function sameViewport(left: BrowserViewport | null, right: BrowserViewport): boolean {
  return left?.width === right.width && left.height === right.height;
}

export class BrowserViewportResizeQueue {
  private pending: { viewport: BrowserViewport; mode: BrowserViewportMode } | null = null;
  private active = false;
  private disposed = false;
  private applied: { viewport: BrowserViewport; mode: BrowserViewportMode } | null = null;
  private readonly idleWaiters = new Set<() => void>();

  constructor(
    private readonly resize: (
      viewport: BrowserViewport,
      mode: BrowserViewportMode
    ) => Promise<BrowserViewport>,
    private readonly onApplied: (viewport: BrowserViewport) => void,
    private readonly onError: (error: unknown) => void
  ) {}

  enqueue(viewport: BrowserViewport, mode: BrowserViewportMode): void {
    if (
      this.disposed ||
      (this.pending?.mode === mode && sameViewport(this.pending.viewport, viewport))
    ) {
      return;
    }
    if (
      !this.active &&
      this.applied?.mode === mode &&
      sameViewport(this.applied.viewport, viewport)
    ) {
      return;
    }
    this.pending = { viewport, mode };
    void this.drain();
  }

  whenIdle(): Promise<void> {
    if (!this.active && !this.pending) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    if (!this.active) this.resolveIdle();
  }

  private async drain(): Promise<void> {
    if (this.active || this.disposed || !this.pending) return;
    const target = this.pending;
    this.pending = null;
    this.active = true;
    try {
      const appliedViewport = await this.resize(target.viewport, target.mode);
      this.applied = { viewport: appliedViewport, mode: target.mode };
      if (!this.disposed && !this.pending) this.onApplied(appliedViewport);
    } catch (error) {
      if (!this.disposed && !this.pending) this.onError(error);
    } finally {
      this.active = false;
      if (!this.disposed && this.pending) void this.drain();
      else this.resolveIdle();
    }
  }

  private resolveIdle(): void {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
