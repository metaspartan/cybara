export interface BrowserScrollDelta {
  deltaX: number;
  deltaY: number;
}

export interface BrowserPreviewFrameSource {
  screenshot: string;
}

export const BROWSER_SCROLL_FRAME_MS = 8;
export const BROWSER_PREVIEW_REFRESH_MS = 90;
export const BROWSER_SCROLL_DELTA_LIMIT = 4_000;

function boundedDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(BROWSER_SCROLL_DELTA_LIMIT, Math.max(-BROWSER_SCROLL_DELTA_LIMIT, value));
}

export function normalizeBrowserWheelDelta(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  viewportHeight: number
): BrowserScrollDelta {
  const scale = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(320, viewportHeight) : 1;
  return {
    deltaX: boundedDelta(deltaX * scale),
    deltaY: boundedDelta(deltaY * scale),
  };
}

export function mergeBrowserScrollDelta(
  current: BrowserScrollDelta,
  incoming: BrowserScrollDelta
): BrowserScrollDelta {
  return {
    deltaX: boundedDelta(current.deltaX + incoming.deltaX),
    deltaY: boundedDelta(current.deltaY + incoming.deltaY),
  };
}

export class BrowserScrollBatcher {
  private pending: BrowserScrollDelta = { deltaX: 0, deltaY: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private disposed = false;
  private readonly idleWaiters = new Set<() => void>();

  constructor(
    private readonly handler: (delta: BrowserScrollDelta) => Promise<void>,
    private readonly frameMs = BROWSER_SCROLL_FRAME_MS,
    private readonly onError: (error: unknown) => void = () => undefined
  ) {}

  enqueue(delta: BrowserScrollDelta): void {
    if (this.disposed) return;
    this.pending = mergeBrowserScrollDelta(this.pending, delta);
    this.schedule();
  }

  async whenIdle(): Promise<void> {
    if (!this.active && this.timer === null && this.isPendingEmpty()) return;
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  dispose(): void {
    this.disposed = true;
    this.pending = { deltaX: 0, deltaY: 0 };
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.active) this.resolveIdle();
  }

  private schedule(): void {
    if (this.active || this.timer !== null || this.isPendingEmpty()) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.flush();
      },
      Math.max(0, this.frameMs)
    );
  }

  private async flush(): Promise<void> {
    if (this.active || this.disposed || this.isPendingEmpty()) return;
    const delta = this.pending;
    this.pending = { deltaX: 0, deltaY: 0 };
    this.active = true;
    try {
      await this.handler(delta);
    } catch (error) {
      this.onError(error);
    } finally {
      this.active = false;
      if (!this.disposed && !this.isPendingEmpty()) this.schedule();
      else this.resolveIdle();
    }
  }

  private isPendingEmpty(): boolean {
    return this.pending.deltaX === 0 && this.pending.deltaY === 0;
  }

  private resolveIdle(): void {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

export function decodeBrowserPreviewImage(source: string): Promise<void> {
  const image = new Image();
  image.decoding = "async";
  image.src = source;
  if (typeof image.decode === "function") return image.decode();
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Browser preview frame could not be decoded"));
  });
}

export class BrowserFramePresenter<Frame extends BrowserPreviewFrameSource> {
  private sequence = 0;
  private presentedSource = "";
  private disposed = false;

  constructor(
    private readonly decode: (source: string) => Promise<void>,
    private readonly present: (frame: Frame) => void,
    private readonly onError: (error: unknown) => void = () => undefined
  ) {}

  enqueue(frame: Frame): void {
    if (this.disposed) return;
    const sequence = ++this.sequence;
    if (frame.screenshot === this.presentedSource) {
      this.present(frame);
      return;
    }
    void this.decode(frame.screenshot).then(
      () => {
        if (this.disposed || sequence !== this.sequence) return;
        this.presentedSource = frame.screenshot;
        this.present(frame);
      },
      (error: unknown) => {
        if (!this.disposed && sequence === this.sequence) this.onError(error);
      }
    );
  }

  reset(): void {
    this.sequence += 1;
    this.presentedSource = "";
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }
}
