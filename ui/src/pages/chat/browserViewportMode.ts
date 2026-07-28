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
  private pending: BrowserViewport | null = null;
  private active = false;
  private disposed = false;
  private applied: BrowserViewport | null = null;
  private readonly idleWaiters = new Set<() => void>();

  constructor(
    private readonly resize: (viewport: BrowserViewport) => Promise<BrowserViewport>,
    private readonly onApplied: (viewport: BrowserViewport) => void,
    private readonly onError: (error: unknown) => void
  ) {}

  enqueue(viewport: BrowserViewport): void {
    if (this.disposed || sameViewport(this.pending, viewport)) return;
    if (!this.active && sameViewport(this.applied, viewport)) return;
    this.pending = viewport;
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
      const applied = await this.resize(target);
      this.applied = applied;
      if (!this.disposed && !this.pending) this.onApplied(applied);
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
